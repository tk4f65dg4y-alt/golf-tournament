const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireCaptain, requireCasey } = require('../src/auth');
const { MATCHES, TEAMS, findMatch } = require('../src/data');
const { buildAllMatchBundles } = require('../src/matchData');

router.get('/captain', requireCaptain, async (req, res, next) => {
  try {
    const { rows: timings } = await pool.query('SELECT * FROM timings ORDER BY sort_order, id');
    const { rows: suddenDeathRows } = await pool.query('SELECT * FROM sudden_death ORDER BY id DESC LIMIT 1');
    const { rows: rules } = await pool.query('SELECT * FROM rules ORDER BY sort_order, id');
    const bundles = await buildAllMatchBundles();
    res.render('captain', { timings, suddenDeath: suddenDeathRows[0] || null, bundles, teams: TEAMS, rules });
  } catch (err) {
    next(err);
  }
});

router.post('/captain/rules', requireCaptain, async (req, res, next) => {
  try {
    const { title, text } = req.body;
    if (!title || !title.trim() || !text || !text.trim()) return res.redirect('/captain');
    const { rows } = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM rules');
    await pool.query('INSERT INTO rules (title, text, sort_order, updated_by) VALUES ($1, $2, $3, $4)', [title.trim(), text.trim(), rows[0].n, req.user.name]);
    res.redirect('/captain');
  } catch (err) {
    next(err);
  }
});

router.post('/captain/rules/:id', requireCaptain, async (req, res, next) => {
  try {
    const { title, text } = req.body;
    if (!title || !title.trim() || !text || !text.trim()) return res.redirect('/captain');
    await pool.query('UPDATE rules SET title = $1, text = $2, updated_by = $3, updated_at = now() WHERE id = $4', [title.trim(), text.trim(), req.user.name, req.params.id]);
    res.redirect('/captain');
  } catch (err) {
    next(err);
  }
});

router.post('/captain/rules/:id/delete', requireCaptain, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM rules WHERE id = $1', [req.params.id]);
    res.redirect('/captain');
  } catch (err) {
    next(err);
  }
});

// Simple up/down reordering -- swaps sort_order with whichever rule is
// currently adjacent, so it just needs the current ordering, not a
// separate position field to keep in sync.
router.post('/captain/rules/:id/move', requireCaptain, async (req, res, next) => {
  try {
    const dir = req.body.dir === 'up' ? 'up' : 'down';
    const { rows } = await pool.query('SELECT * FROM rules ORDER BY sort_order, id');
    const idx = rows.findIndex((r) => String(r.id) === String(req.params.id));
    if (idx === -1) return res.redirect('/captain');
    const swapWith = dir === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= rows.length) return res.redirect('/captain');
    const a = rows[idx];
    const b = rows[swapWith];
    await pool.query('UPDATE rules SET sort_order = $1 WHERE id = $2', [b.sort_order, a.id]);
    await pool.query('UPDATE rules SET sort_order = $1 WHERE id = $2', [a.sort_order, b.id]);
    res.redirect('/captain');
  } catch (err) {
    next(err);
  }
});

router.post('/captain/timings', requireCaptain, async (req, res, next) => {
  try {
    const { time, label } = req.body;
    if (!time || !label) return res.redirect('/captain');
    const { rows } = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM timings');
    await pool.query('INSERT INTO timings (time, label, sort_order) VALUES ($1, $2, $3)', [time.trim(), label.trim(), rows[0].n]);
    res.redirect('/captain');
  } catch (err) {
    next(err);
  }
});

router.post('/captain/timings/:id/delete', requireCaptain, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM timings WHERE id = $1', [req.params.id]);
    res.redirect('/captain');
  } catch (err) {
    next(err);
  }
});

// Resetting scores (one match, or everything) is Casey-only -- not shared
// with Reggel like the rest of the captain tools.
router.post('/captain/matches/:id/reset', requireCasey, async (req, res, next) => {
  try {
    if (!findMatch(req.params.id)) return res.redirect('/captain');
    await pool.query('DELETE FROM scores WHERE match_id = $1', [req.params.id]);
    res.redirect('/captain');
  } catch (err) {
    next(err);
  }
});

router.post('/captain/reset-all', requireCasey, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM scores');
    res.redirect('/captain');
  } catch (err) {
    next(err);
  }
});

router.post('/captain/override', requireCaptain, async (req, res, next) => {
  try {
    const { matchId, holeNumber, playerId, gross, pickedUp } = req.body;
    const match = findMatch(matchId);
    if (!match) return res.redirect('/captain');
    const h = Number(holeNumber);
    if (!h || h < 1 || h > match.holeCount) return res.redirect('/captain');
    if (![...match.sideA, ...match.sideB].includes(playerId)) return res.redirect('/captain');

    if (pickedUp === 'on') {
      await pool.query(
        `INSERT INTO scores (match_id, hole_number, player_id, gross, picked_up, entered_by, updated_at)
         VALUES ($1, $2, $3, NULL, TRUE, $4, now())
         ON CONFLICT (match_id, hole_number, player_id) DO UPDATE SET gross = NULL, picked_up = TRUE, entered_by = $4, updated_at = now()`,
        [matchId, h, playerId, `${req.user.name} (override)`]
      );
    } else if (!gross) {
      await pool.query('DELETE FROM scores WHERE match_id = $1 AND hole_number = $2 AND player_id = $3', [matchId, h, playerId]);
    } else {
      const g = Number(gross);
      if (Number.isFinite(g) && g >= 1 && g <= 15) {
        await pool.query(
          `INSERT INTO scores (match_id, hole_number, player_id, gross, picked_up, entered_by, updated_at)
           VALUES ($1, $2, $3, $4, FALSE, $5, now())
           ON CONFLICT (match_id, hole_number, player_id) DO UPDATE SET gross = $4, picked_up = FALSE, entered_by = $5, updated_at = now()`,
          [matchId, h, playerId, g, `${req.user.name} (override)`]
        );
      }
    }
    res.redirect('/captain');
  } catch (err) {
    next(err);
  }
});

router.post('/captain/sudden-death', requireCaptain, async (req, res, next) => {
  try {
    const { winnerTeam } = req.body;
    if (!['casey', 'reggel'].includes(winnerTeam)) return res.redirect('/captain');
    await pool.query('INSERT INTO sudden_death (winner_team, recorded_by) VALUES ($1, $2)', [winnerTeam, req.user.name]);
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

router.post('/captain/sudden-death/clear', requireCaptain, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM sudden_death');
    res.redirect('/captain');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
