const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth, requirePlayer } = require('../src/auth');
const { PLAYERS, COURSES, canScoreMatch } = require('../src/data');
const { buildAllMatchBundles, buildMatchBundle, createMatch } = require('../src/matchData');

router.get('/matches', requireAuth, async (req, res, next) => {
  try {
    const bundles = await buildAllMatchBundles();
    res.render('matches', { bundles });
  } catch (err) {
    next(err);
  }
});

// Any of the 8 players can set up a new match against any combination of
// the others -- there's no more fixed draw. A spectator can watch but not
// start one.
router.get('/matches/new', requirePlayer, (req, res) => {
  res.render('match-new', { players: PLAYERS, courses: COURSES, error: null, values: {} });
});

router.post('/matches', requirePlayer, async (req, res, next) => {
  try {
    const course = COURSES[req.body.courseId];
    if (!course) {
      return res.status(400).render('match-new', { players: PLAYERS, courses: COURSES, error: 'Pick a course.', values: req.body });
    }

    const sideA = [];
    const sideB = [];
    for (const p of PLAYERS) {
      const side = req.body[`side_${p.id}`];
      if (side === 'A') sideA.push(p.id);
      else if (side === 'B') sideB.push(p.id);
    }

    if (!sideA.length || !sideB.length) {
      return res.status(400).render('match-new', { players: PLAYERS, courses: COURSES, error: 'Put at least one player on each side.', values: req.body });
    }

    const matchId = await createMatch({ courseId: course.id, holeCount: course.holes.length, sideA, sideB, createdBy: req.user.id });
    res.redirect(`/matches/${matchId}`);
  } catch (err) {
    next(err);
  }
});

router.get('/matches/:id', requireAuth, async (req, res, next) => {
  try {
    const bundle = await buildMatchBundle(req.params.id);
    if (!bundle) return res.status(404).render('error', { message: 'Match not found.' });
    res.render('match-detail', { b: bundle, canScore: canScoreMatch(req.user, bundle.match) });
  } catch (err) {
    next(err);
  }
});

router.get('/matches/:id/score', requirePlayer, async (req, res, next) => {
  try {
    const bundle = await buildMatchBundle(req.params.id);
    if (!bundle) return res.status(404).render('error', { message: 'Match not found.' });
    if (!canScoreMatch(req.user, bundle.match)) {
      return res.status(403).render('error', { message: 'Only players in this match (or a captain) can enter scores.' });
    }
    let startHole = Number(req.query.hole) || 1;
    startHole = Math.min(Math.max(startHole, 1), bundle.match.holeCount);
    res.render('scoring', { b: bundle, startHole });
  } catch (err) {
    next(err);
  }
});

// ---- Score sync API (used by the offline-first scoring screen) ----

router.get('/api/matches/:id/scores', requirePlayer, async (req, res, next) => {
  try {
    const bundle = await buildMatchBundle(req.params.id);
    if (!bundle) return res.status(404).json({ error: 'not found' });
    res.json({ scores: bundle.scores, entryMeta: bundle.entryMeta, stats: bundle.stats, conflicts: bundle.conflicts, resetAt: bundle.resetAt });
  } catch (err) {
    next(err);
  }
});

// Putts/fairwayHit/gir are optional and independent of gross/pickedUp -- any
// of them may be omitted from the body, meaning "leave that column as it
// currently is". The offline-first client always sends its full merged
// local view of the hole (see public/js/scoring.js), so in practice nothing
// gets silently clobbered even though this is a full row upsert.
router.post('/api/matches/:id/scores', requirePlayer, async (req, res, next) => {
  try {
    const matchId = req.params.id;
    const bundle = await buildMatchBundle(matchId);
    if (!bundle) return res.status(404).json({ error: 'not found' });
    if (!canScoreMatch(req.user, bundle.match)) return res.status(403).json({ error: 'not allowed' });

    const { holeNumber, playerId, gross, pickedUp, putts, fairwayHit, gir } = req.body;
    const h = Number(holeNumber);
    if (!h || h < 1 || h > bundle.match.holeCount) return res.status(400).json({ error: 'bad hole' });
    if (![...bundle.match.sideA, ...bundle.match.sideB].includes(playerId)) return res.status(400).json({ error: 'bad player' });

    let p = null;
    if (putts !== undefined && putts !== null) {
      p = Number(putts);
      if (!Number.isFinite(p) || p < 0 || p > 12) return res.status(400).json({ error: 'bad putts' });
    }
    const fh = typeof fairwayHit === 'boolean' ? fairwayHit : null;
    const g2 = typeof gir === 'boolean' ? gir : null;

    if (pickedUp) {
      // No score for the hole means no stats for it either -- and clears
      // any stale conflict from before it was picked up.
      await pool.query(
        `INSERT INTO scores (match_id, hole_number, player_id, gross, picked_up, putts, fairway_hit, gir, entered_by, conflict_gross, conflict_entered_by, conflict_at, updated_at)
         VALUES ($1, $2, $3, NULL, TRUE, NULL, NULL, NULL, $4, NULL, NULL, NULL, now())
         ON CONFLICT (match_id, hole_number, player_id) DO UPDATE SET gross = NULL, picked_up = TRUE, putts = NULL, fairway_hit = NULL, gir = NULL, entered_by = $4, conflict_gross = NULL, conflict_entered_by = NULL, conflict_at = NULL, updated_at = now()`,
        [matchId, h, playerId, req.user.id]
      );
    } else if (gross === null || gross === undefined) {
      await pool.query('DELETE FROM scores WHERE match_id = $1 AND hole_number = $2 AND player_id = $3', [matchId, h, playerId]);
    } else {
      const g = Number(gross);
      if (!Number.isFinite(g) || g < 1 || g > 15) return res.status(400).json({ error: 'bad gross' });

      // Anyone in the match can enter anyone's score, so two different
      // people can genuinely disagree on what a hole was. If someone other
      // than whoever entered the existing value now submits a *different*
      // one, don't silently overwrite it -- park it as a conflict instead
      // and leave the original standing until a captain resolves it.
      const { rows: existingRows } = await pool.query(
        'SELECT gross, entered_by, picked_up FROM scores WHERE match_id = $1 AND hole_number = $2 AND player_id = $3',
        [matchId, h, playerId]
      );
      const existing = existingRows[0];
      const isConflict = existing && !existing.picked_up && existing.gross !== null && existing.entered_by && existing.entered_by !== req.user.id && existing.gross !== g;

      if (isConflict) {
        await pool.query(
          `UPDATE scores SET putts = $1, fairway_hit = $2, gir = $3, conflict_gross = $4, conflict_entered_by = $5, conflict_at = now()
           WHERE match_id = $6 AND hole_number = $7 AND player_id = $8`,
          [p, fh, g2, g, req.user.id, matchId, h, playerId]
        );
        return res.json({ ok: true, conflict: true, existingGross: existing.gross, existingEnteredBy: existing.entered_by, updatedAt: new Date().toISOString() });
      }

      await pool.query(
        `INSERT INTO scores (match_id, hole_number, player_id, gross, picked_up, putts, fairway_hit, gir, entered_by, conflict_gross, conflict_entered_by, conflict_at, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, $5, $6, $7, $8, NULL, NULL, NULL, now())
         ON CONFLICT (match_id, hole_number, player_id) DO UPDATE SET gross = $4, picked_up = FALSE, putts = $5, fairway_hit = $6, gir = $7, entered_by = $8, conflict_gross = NULL, conflict_entered_by = NULL, conflict_at = NULL, updated_at = now()`,
        [matchId, h, playerId, g, p, fh, g2, req.user.id]
      );
    }

    res.json({ ok: true, updatedAt: new Date().toISOString(), updatedBy: req.user.name });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
