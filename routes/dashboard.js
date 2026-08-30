const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth } = require('../src/auth');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows: teams } = await pool.query('SELECT * FROM teams ORDER BY id');

    const { rows: matches } = await pool.query(
      `SELECT m.*, r.name AS round_name, r.sort_order AS round_sort
       FROM matches m JOIN rounds r ON r.id = m.round_id
       ORDER BY r.sort_order, m.sort_order`
    );

    for (const m of matches) {
      const { rows: players } = await pool.query(
        `SELECT mp.side, u.id, u.name, u.team_id
         FROM match_players mp JOIN users u ON u.id = mp.user_id
         WHERE mp.match_id = $1`,
        [m.id]
      );
      m.side1 = players.filter((p) => p.side === 1);
      m.side2 = players.filter((p) => p.side === 2);
    }

    const teamTotals = {};
    for (const t of teams) teamTotals[t.id] = 0;
    let pointsPlayed = 0;
    let pointsTotal = 0;

    for (const m of matches) {
      pointsTotal += Number(m.points);
      const side1Team = m.side1[0] && m.side1[0].team_id;
      const side2Team = m.side2[0] && m.side2[0].team_id;
      if (m.team1_result !== null && side1Team && teamTotals[side1Team] !== undefined) {
        teamTotals[side1Team] += Number(m.team1_result);
      }
      if (m.team2_result !== null && side2Team && teamTotals[side2Team] !== undefined) {
        teamTotals[side2Team] += Number(m.team2_result);
      }
      if (m.status === 'complete') pointsPlayed += Number(m.points);
    }

    const liveMatches = matches.filter((m) => m.status === 'in_progress');
    const upcomingMatches = matches.filter((m) => m.status === 'scheduled');
    const completeMatches = matches.filter((m) => m.status === 'complete');

    const { rows: recentPhotos } = await pool.query(
      `SELECT p.*, u.name AS uploader_name FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by
       ORDER BY p.created_at DESC LIMIT 6`
    );
    const { rows: openBets } = await pool.query(
      `SELECT sb.*, u.name AS created_by_name FROM side_bets sb LEFT JOIN users u ON u.id = sb.created_by
       WHERE sb.status = 'open' ORDER BY sb.created_at DESC LIMIT 5`
    );

    res.render('dashboard', {
      teams,
      teamTotals,
      pointsPlayed,
      pointsTotal,
      liveMatches,
      upcomingMatches,
      completeMatches,
      recentPhotos,
      openBets
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
