const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth } = require('../src/auth');
const { buildAllMatchBundles, matchesForPlayer, buildStandings, buildMomentsFeed } = require('../src/matchData');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const bundles = await buildAllMatchBundles();
    const standings = buildStandings(bundles);
    const moments = buildMomentsFeed(bundles, 15);
    const { rows: timings } = await pool.query('SELECT * FROM timings ORDER BY sort_order, id');

    // Any combination of the 8 players can have a match on the go at once --
    // "your match" picks whichever of the current user's own matches is
    // actually in progress, falling back to their next not-yet-started one,
    // then to their most recent match of all if everything's finished.
    let myMatches = [];
    let currentBundle = null;
    if (!req.user.readOnly) {
      const myMatchSummaries = await matchesForPlayer(req.user.id);
      myMatches = myMatchSummaries.map((m) => bundles.find((b) => b.match.id === m.id)).filter(Boolean);
      currentBundle = myMatches.find((b) => b.state.holesPlayed > 0 && !b.state.isComplete)
        || myMatches.find((b) => !b.state.isComplete)
        || myMatches[0]
        || null;
    }

    res.render('home', { standings, timings, myMatches, currentBundle, moments });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
