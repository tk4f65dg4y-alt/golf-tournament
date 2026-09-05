const express = require('express');
const router = express.Router();
const { requireAuth } = require('../src/auth');
const { buildAllMatchBundles, buildStandings } = require('../src/matchData');

router.get('/leaderboard', requireAuth, async (req, res, next) => {
  try {
    const bundles = await buildAllMatchBundles();
    const standings = buildStandings(bundles);
    res.render('leaderboard', { standings, bundles });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
