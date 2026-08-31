const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth, requirePlayer } = require('../src/auth');
const { MATCHES, findMatch, findPlayer } = require('../src/data');
const { askRulesOfficial } = require('../src/rulesOfficial');

async function loadRulings() {
  const { rows } = await pool.query('SELECT * FROM rulings ORDER BY created_at DESC LIMIT 50');
  for (const r of rows) {
    const asker = findPlayer(r.asked_by);
    r.asked_by_name = asker ? asker.name : 'Someone';
    const match = r.match_id ? findMatch(r.match_id) : null;
    r.match_label = match ? `Match ${match.id}` : null;
  }
  return rows;
}

router.get('/rules/official', requireAuth, async (req, res, next) => {
  try {
    const rulings = await loadRulings();
    res.render('rules-official', { rulings, matches: MATCHES, error: null, configured: !!process.env.ANTHROPIC_API_KEY });
  } catch (err) {
    next(err);
  }
});

router.post('/rules/official', requirePlayer, async (req, res, next) => {
  try {
    const question = (req.body.question || '').trim().slice(0, 600);
    const matchId = req.body.matchId ? Number(req.body.matchId) : null;

    if (!question) return res.redirect('/rules/official');

    try {
      const answer = await askRulesOfficial(question, matchId);
      await pool.query(
        'INSERT INTO rulings (question, asked_by, match_id, answer) VALUES ($1, $2, $3, $4)',
        [question, req.user.id, matchId, answer]
      );
      res.redirect('/rules/official');
    } catch (err) {
      const rulings = await loadRulings();
      const message = err.notConfigured ? err.message : "The Rules Official couldn't reach a ruling — try again in a moment.";
      if (!err.notConfigured) console.error('Rules Official error:', err);
      res.render('rules-official', { rulings, matches: MATCHES, error: message, configured: !!process.env.ANTHROPIC_API_KEY });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
