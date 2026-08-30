const bcrypt = require('bcryptjs');
const { pool } = require('./db');

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/** Attaches req.user / res.locals.user (or null) based on the session. Runs on every request. */
async function loadUser(req, res, next) {
  if (!req.session || !req.session.userId) {
    req.user = null;
    res.locals.user = null;
    return next();
  }
  try {
    const { rows } = await pool.query(
      `SELECT u.*, t.name AS team_name, t.color AS team_color
       FROM users u LEFT JOIN teams t ON t.id = u.team_id
       WHERE u.id = $1`,
      [req.session.userId]
    );
    req.user = rows[0] || null;
    res.locals.user = req.user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (!req.user.is_admin) return res.status(403).render('error', { message: 'Admins only.' });
  next();
}

module.exports = { hashPassword, comparePassword, loadUser, requireAuth, requireAdmin };
