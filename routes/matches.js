const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth, requirePlayer } = require('../src/auth');
const { canScoreMatch } = require('../src/data');
const { buildAllMatchBundles, buildMatchBundle } = require('../src/matchData');

router.get('/matches', requireAuth, async (req, res, next) => {
  try {
    const bundles = await buildAllMatchBundles();
    res.render('matches', {
      morning: bundles.filter((b) => b.match.session === 'morning'),
      afternoon: bundles.filter((b) => b.match.session === 'afternoon')
    });
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
    res.json({ scores: bundle.scores, entryMeta: bundle.entryMeta });
  } catch (err) {
    next(err);
  }
});

router.post('/api/matches/:id/scores', requirePlayer, async (req, res, next) => {
  try {
    const matchId = req.params.id;
    const bundle = await buildMatchBundle(matchId);
    if (!bundle) return res.status(404).json({ error: 'not found' });
    if (!canScoreMatch(req.user, bundle.match)) return res.status(403).json({ error: 'not allowed' });

    const { holeNumber, playerId, gross, pickedUp } = req.body;
    const h = Number(holeNumber);
    if (!h || h < 1 || h > bundle.match.holeCount) return res.status(400).json({ error: 'bad hole' });
    if (![...bundle.match.sideA, ...bundle.match.sideB].includes(playerId)) return res.status(400).json({ error: 'bad player' });

    if (pickedUp) {
      await pool.query(
        `INSERT INTO scores (match_id, hole_number, player_id, gross, picked_up, entered_by, updated_at)
         VALUES ($1, $2, $3, NULL, TRUE, $4, now())
         ON CONFLICT (match_id, hole_number, player_id) DO UPDATE SET gross = NULL, picked_up = TRUE, entered_by = $4, updated_at = now()`,
        [matchId, h, playerId, req.user.id]
      );
    } else if (gross === null || gross === undefined) {
      await pool.query('DELETE FROM scores WHERE match_id = $1 AND hole_number = $2 AND player_id = $3', [matchId, h, playerId]);
    } else {
      const g = Number(gross);
      if (!Number.isFinite(g) || g < 1 || g > 15) return res.status(400).json({ error: 'bad gross' });
      await pool.query(
        `INSERT INTO scores (match_id, hole_number, player_id, gross, picked_up, entered_by, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, $5, now())
         ON CONFLICT (match_id, hole_number, player_id) DO UPDATE SET gross = $4, picked_up = FALSE, entered_by = $5, updated_at = now()`,
        [matchId, h, playerId, g, req.user.id]
      );
    }

    res.json({ ok: true, updatedAt: new Date().toISOString(), updatedBy: req.user.name });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
