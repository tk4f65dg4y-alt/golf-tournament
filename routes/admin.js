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
    const { name, handicap, team_id, is_admin } = req.body;
    await pool.query(
      `UPDATE users SET name = $1, handicap = $2, team_id = $3, is_admin = $4 WHERE id = $5`,
      [
        name && name.trim() ? name.trim() : req.body.currentName,
        handicap === '' || handicap === undefined ? 0 : Number(handicap),
        team_id ? Number(team_id) : null,
        is_admin === 'on',
        req.params.id
      ]
    );
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
