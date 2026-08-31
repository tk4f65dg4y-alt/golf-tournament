const express = require('express');
const router = express.Router();
const { requireAuth } = require('../src/auth');
const { RULES } = require('../src/data');

router.get('/rules', requireAuth, (req, res) => res.render('rules', { rules: RULES }));

module.exports = router;
