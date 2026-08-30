const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth } = require('../src/auth');

router.get('/players', requireAuth, async (req, res, next) => {
  try {
    const { rows: teams } = await pool.query('SELECT * FROM teams ORDER BY id');
    const { rows: users } = await pool.query(
      `SELECT u.*, t.name AS team_name, t.color AS team_color
       FROM users u LEFT JOIN teams t ON t.id = u.team_id
       ORDER BY t.id NULLS LAST, u.name`
    );
    res.render('players', { teams, users });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => res.redirect(`/players/${req.user.id}`));

router.get('/players/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows: playerRows } = await pool.query(
      `SELECT u.*, t.name AS team_name, t.color AS team_color
       FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = $1`,
      [req.params.id]
    );
    if (!playerRows.length) return res.status(404).render('error', { message: 'Player not found.' });
    const player = playerRows[0];

    const { rows: holes } = await pool.query(
      `SELECT phs.hole_number, phs.strokes, ch.par, r.name AS round_name, m.id AS match_id, m.format
       FROM player_hole_scores phs
       JOIN matches m ON m.id = phs.match_id
       JOIN rounds r ON r.id = m.round_id
       JOIN course_holes ch ON ch.course_id = r.course_id AND ch.hole_number = phs.hole_number
       WHERE phs.user_id = $1 AND phs.strokes IS NOT NULL
       ORDER BY r.sort_order DESC, m.sort_order, phs.hole_number`,
      [req.params.id]
    );

    const summary = { played: 0, albatross: 0, eagle: 0, birdie: 0, par: 0, bogey: 0, worse: 0 };
    for (const h of holes) {
      const diff = h.strokes - h.par;
      h.diff = diff;
      h.label = diff <= -3 ? 'Albatross' : diff === -2 ? 'Eagle' : diff === -1 ? 'Birdie' : diff === 0 ? 'Par' : diff === 1 ? 'Bogey' : 'Double+';
      summary.played++;
      if (diff <= -3) summary.albatross++;
      else if (diff === -2) summary.eagle++;
      else if (diff === -1) summary.birdie++;
      else if (diff === 0) summary.par++;
      else if (diff === 1) summary.bogey++;
      else summary.worse++;
    }

    res.render('player-detail', { player, holes, summary, isSelf: req.user.id === player.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
