const express = require('express');
const router = express.Router();
const { requireAuth } = require('../src/auth');
const { buildAllMatchBundles, buildPerformanceData } = require('../src/matchData');

router.get('/performance', requireAuth, async (req, res, next) => {
  try {
    const scoring = req.query.scoring === 'net' ? 'net' : 'gross';
    const bundles = await buildAllMatchBundles();
    const rows = buildPerformanceData(bundles, scoring);
    res.render('performance', { rows, scoring });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
