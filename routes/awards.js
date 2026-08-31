const express = require('express');
const router = express.Router();
const { requireAuth } = require('../src/auth');
const { buildAllMatchBundles, cupStatus, buildAwards } = require('../src/matchData');
const { pool } = require('../src/db');

router.get('/awards', requireAuth, async (req, res, next) => {
  try {
    const bundles = await buildAllMatchBundles();
    const { rows: suddenDeathRows } = await pool.query('SELECT * FROM sudden_death ORDER BY id DESC LIMIT 1');
    const { cupDecided } = cupStatus(bundles, suddenDeathRows[0] || null);
    const awards = buildAwards(bundles);
    res.render('awards', { awards, cupDecided });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
