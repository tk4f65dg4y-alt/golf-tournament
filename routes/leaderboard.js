const express = require('express');
const router = express.Router();
const { requireAuth } = require('../src/auth');
const { buildAllMatchBundles, teamScores } = require('../src/matchData');

router.get('/leaderboard', requireAuth, async (req, res, next) => {
  try {
    const bundles = await buildAllMatchBundles();
    const scores = teamScores(bundles);
    const morning = bundles.filter((b) => b.match.session === 'morning');
    const afternoon = bundles.filter((b) => b.match.session === 'afternoon');
    res.render('leaderboard', { scores, morning, afternoon });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
