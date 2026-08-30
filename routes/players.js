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

module.exports = router;
