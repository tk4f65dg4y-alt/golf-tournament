const express = require('express');
const router = express.Router();
const { requireAuth } = require('../src/auth');
const { buildAllMatchBundles, buildAwards } = require('../src/matchData');

router.get('/awards', requireAuth, async (req, res, next) => {
  try {
    const bundles = await buildAllMatchBundles();
    const awards = buildAwards(bundles);
    res.render('awards', { awards });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
