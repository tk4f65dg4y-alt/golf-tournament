const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireCaptain } = require('../src/auth');
const { MATCHES, TEAMS, findMatch } = require('../src/data');
const { buildAllMatchBundles } = require('../src/matchData');

router.get('/captain', requireCaptain, async (req, res, next) => {
  try {
    const { rows: timings } = await pool.query('SELECT * FROM timings ORDER BY sort_order, id');
    const { rows: suddenDeathRows } = await pool.query('SELECT * FROM sudden_death ORDER BY id DESC LIMIT 1');
    const bundles = await buildAllMatchBundles();
    res.render('captain', { timings, suddenDeath: suddenDeathRows[0] || null, bundles, teams: TEAMS });
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

router.post('/captain/matches/:id/reset', requireCaptain, async (req, res, next) => {
  try {
    if (!findMatch(req.params.id)) return res.redirect('/captain');
    await pool.query('DELETE FROM scores WHERE match_id = $1', [req.params.id]);
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
