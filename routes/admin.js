const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAdmin } = require('../src/auth');

router.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    const { rows: teams } = await pool.query('SELECT * FROM teams ORDER BY id');
    const { rows: users } = await pool.query(
      `SELECT u.*, t.name AS team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id ORDER BY u.name`
    );
    res.render('admin', { teams, users, inviteCode: process.env.INVITE_CODE || null });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/teams', requireAdmin, async (req, res, next) => {
  try {
    const { name, color } = req.body;
    if (name && name.trim()) {
      await pool.query('INSERT INTO teams (name, color) VALUES ($1, $2)', [name.trim(), color || '#1b6b3a']);
    }
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
});

router.post('/admin/teams/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM teams WHERE id = $1', [req.params.id]);
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
});

router.post('/admin/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, handicap, team_id, is_admin, is_captain } = req.body;
    const userId = req.params.id;
    const teamId = team_id ? Number(team_id) : null;
    const wantsCaptain = is_captain === 'on';

    await pool.query(
      `UPDATE users SET name = $1, handicap = $2, team_id = $3, is_admin = $4, is_captain = $5 WHERE id = $6`,
      [
        name && name.trim() ? name.trim() : req.body.currentName,
        handicap === '' || handicap === undefined ? 0 : Number(handicap),
        teamId,
        is_admin === 'on',
        Boolean(wantsCaptain && teamId),
        userId
      ]
    );

    // Only one captain per team — checking a new captain clears the old one.
    if (wantsCaptain && teamId) {
      await pool.query(
        `UPDATE users SET is_captain = FALSE WHERE team_id = $1 AND id != $2`,
        [teamId, userId]
      );
    }

    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
