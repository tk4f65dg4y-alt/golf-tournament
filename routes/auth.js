const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { hashPassword, comparePassword } = require('../src/auth');

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { error: null, form: {} });
});

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, invite_code } = req.body;
    if (req.user) return res.redirect('/');

    if (!name || !email || !password) {
      return res.render('register', { error: 'All fields are required.', form: req.body });
    }
    const requiredCode = process.env.INVITE_CODE;
    if (requiredCode && invite_code !== requiredCode) {
      return res.render('register', { error: 'Invalid invite code.', form: req.body });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length) {
      return res.render('register', { error: 'An account with that email already exists.', form: req.body });
    }

    const countRes = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    const isFirstUser = countRes.rows[0].n === 0;

    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, is_admin) VALUES ($1, $2, $3, $4) RETURNING id`,
      [name.trim(), email.toLowerCase().trim(), passwordHash, isFirstUser]
    );

    req.session.userId = rows[0].id;
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { error: null, form: {} });
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [(email || '').toLowerCase().trim()]);
    const u = rows[0];
    if (!u || !(await comparePassword(password || '', u.password_hash))) {
      return res.render('login', { error: 'Incorrect email or password.', form: req.body });
    }
    req.session.userId = u.id;
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
