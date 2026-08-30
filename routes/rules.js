const express = require('express');
const router = express.Router();
const { requireAuth } = require('../src/auth');

router.get('/rules', requireAuth, (req, res) => res.render('rules'));

module.exports = router;
