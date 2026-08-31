const express = require('express');
const router = express.Router();
const { requireAuth } = require('../src/auth');
const { pool } = require('../src/db');

router.get('/rules', requireAuth, async (req, res, next) => {
  try {
    const { rows: rules } = await pool.query('SELECT * FROM rules ORDER BY sort_order, id');
    res.render('rules', { rules });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
