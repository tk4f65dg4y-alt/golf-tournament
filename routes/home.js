const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth } = require('../src/auth');
const { matchesForPlayer, findPlayer } = require('../src/data');
const { buildAllMatchBundles, cupStatus, buildMomentsFeed } = require('../src/matchData');

const SESSION_ORDER = { morning: 0, afternoon: 1 };

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const bundles = await buildAllMatchBundles();

    const { rows: timings } = await pool.query('SELECT * FROM timings ORDER BY sort_order, id');
    const { rows: suddenDeathRows } = await pool.query('SELECT * FROM sudden_death ORDER BY id DESC LIMIT 1');
    const suddenDeath = suddenDeathRows[0] || null;
    const cupInfo = cupStatus(bundles, suddenDeath);
    const { scores, cupDecided, tiedAt3 } = cupInfo;
    const moments = buildMomentsFeed(bundles, cupInfo, suddenDeath, 15);

    let myMatches = [];
    let currentBundle = null;
    if (!req.user.readOnly) {
      const myIds = matchesForPlayer(req.user.id).map((m) => m.id).sort((a, b) => {
        const ma = bundles.find((x) => x.match.id === a).match;
        const mb = bundles.find((x) => x.match.id === b).match;
        return SESSION_ORDER[ma.session] - SESSION_ORDER[mb.session];
      });
      myMatches = myIds.map((id) => bundles.find((b) => b.match.id === id));
      currentBundle = myMatches.find((b) => b.state.holesPlayed > 0 && !b.state.isComplete)
        || myMatches.find((b) => !b.state.isComplete)
        || myMatches[myMatches.length - 1]
        || null;
    }

    res.render('home', { bundles, scores, timings, suddenDeath, cupDecided, tiedAt3, myMatches, currentBundle, moments });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
