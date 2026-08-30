const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth, requireAdmin } = require('../src/auth');
const { computeMatchStatus } = require('../src/matchLogic');

router.get('/rounds', requireAuth, async (req, res, next) => {
  try {
    const { rows: rounds } = await pool.query(
      `SELECT r.*, c.name AS course_name FROM rounds r LEFT JOIN courses c ON c.id = r.course_id
       ORDER BY r.sort_order, r.round_date NULLS LAST, r.id`
    );
    const { rows: courses } = await pool.query('SELECT * FROM courses ORDER BY name');
    res.render('rounds', { rounds, courses });
  } catch (err) {
    next(err);
  }
});

router.post('/rounds', requireAdmin, async (req, res, next) => {
  try {
    const { name, course, course_id, round_date, format_note } = req.body;
    if (!name || !name.trim()) return res.redirect('/rounds');
    const { rows } = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM rounds');
    await pool.query(
      `INSERT INTO rounds (name, course, course_id, round_date, format_note, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
      [name.trim(), course || null, course_id ? Number(course_id) : null, round_date || null, format_note || null, rows[0].n]
    );
    res.redirect('/rounds');
  } catch (err) {
    next(err);
  }
});

router.post('/rounds/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM rounds WHERE id = $1', [req.params.id]);
    res.redirect('/rounds');
  } catch (err) {
    next(err);
  }
});

router.get('/rounds/:id', requireAuth, async (req, res, next) => {
  try {
    const roundId = req.params.id;
    const { rows: roundRows } = await pool.query(
      `SELECT r.*, c.name AS course_name FROM rounds r LEFT JOIN courses c ON c.id = r.course_id WHERE r.id = $1`,
      [roundId]
    );
    if (!roundRows.length) return res.status(404).render('error', { message: 'Round not found.' });
    const round = roundRows[0];

    let courseHoleCount = 0;
    if (round.course_id) {
      const { rows: chRows } = await pool.query('SELECT COUNT(*)::int AS n FROM course_holes WHERE course_id = $1', [round.course_id]);
      courseHoleCount = chRows[0].n;
    }
    round.hasFullCourse = courseHoleCount === 18;

    const { rows: matches } = await pool.query(
      `SELECT * FROM matches WHERE round_id = $1 ORDER BY sort_order, id`,
      [roundId]
    );

    for (const m of matches) {
      const { rows: holes } = await pool.query(
        'SELECT hole_number, winner FROM match_holes WHERE match_id = $1',
        [m.id]
      );
      m.statusInfo = computeMatchStatus(holes, Number(m.points));

      const { rows: players } = await pool.query(
        `SELECT mp.side, u.id, u.name, u.team_id, u.is_captain, t.name AS team_name
         FROM match_players mp JOIN users u ON u.id = mp.user_id
         LEFT JOIN teams t ON t.id = u.team_id
         WHERE mp.match_id = $1 ORDER BY mp.side, u.name`,
        [m.id]
      );
      m.side1 = players.filter((p) => p.side === 1);
      m.side2 = players.filter((p) => p.side === 2);
    }

    const { rows: teams } = await pool.query('SELECT * FROM teams ORDER BY id');
    const { rows: users } = await pool.query('SELECT * FROM users ORDER BY name');
    const { rows: courses } = await pool.query('SELECT * FROM courses ORDER BY name');

    res.render('round-detail', { round, matches, teams, users, courses });
  } catch (err) {
    next(err);
  }
});

router.post('/rounds/:id/course', requireAdmin, async (req, res, next) => {
  try {
    const { course_id } = req.body;
    await pool.query('UPDATE rounds SET course_id = $1 WHERE id = $2', [course_id ? Number(course_id) : null, req.params.id]);
    res.redirect(`/rounds/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/rounds/:id/matches', requireAdmin, async (req, res, next) => {
  try {
    const roundId = req.params.id;
    const { format, points, side1, side2, notes } = req.body;
    const side1Ids = [].concat(side1 || []).filter(Boolean).map(Number);
    const side2Ids = [].concat(side2 || []).filter(Boolean).map(Number);

    if (!side1Ids.length || !side2Ids.length) {
      return res.redirect(`/rounds/${roundId}`);
    }

    const { rows: countRows } = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM matches WHERE round_id = $1',
      [roundId]
    );

    const { rows: matchRows } = await pool.query(
      `INSERT INTO matches (round_id, format, points, notes, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [roundId, format || 'singles', points || 1, notes || null, countRows[0].n]
    );
    const matchId = matchRows[0].id;

    for (const uid of side1Ids) {
      await pool.query('INSERT INTO match_players (match_id, user_id, side) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING', [matchId, uid]);
    }
    for (const uid of side2Ids) {
      await pool.query('INSERT INTO match_players (match_id, user_id, side) VALUES ($1, $2, 2) ON CONFLICT DO NOTHING', [matchId, uid]);
    }

    res.redirect(`/rounds/${roundId}`);
  } catch (err) {
    next(err);
  }
});

router.post('/rounds/:roundId/matches/:matchId/delete', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM matches WHERE id = $1', [req.params.matchId]);
    res.redirect(`/rounds/${req.params.roundId}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
