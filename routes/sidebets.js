const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth } = require('../src/auth');

async function loadBets() {
  const { rows: bets } = await pool.query(
    `SELECT sb.*, u.name AS created_by_name, w.name AS winner_name
     FROM side_bets sb
     LEFT JOIN users u ON u.id = sb.created_by
     LEFT JOIN users w ON w.id = sb.winner_user_id
     ORDER BY sb.status ASC, sb.created_at DESC`
  );
  for (const b of bets) {
    const { rows: participants } = await pool.query(
      `SELECT u.id, u.name FROM side_bet_participants sbp JOIN users u ON u.id = sbp.user_id
       WHERE sbp.side_bet_id = $1 ORDER BY u.name`,
      [b.id]
    );
    b.participants = participants;
  }
  return bets;
}

router.get('/sidebets', requireAuth, async (req, res, next) => {
  try {
    const bets = await loadBets();
    const { rows: users } = await pool.query('SELECT id, name FROM users ORDER BY name');
    res.render('sidebets', { bets, users });
  } catch (err) {
    next(err);
  }
});

router.post('/sidebets', requireAuth, async (req, res, next) => {
  try {
    const { description, wager, participants } = req.body;
    if (!description || !description.trim()) return res.redirect('/sidebets');
    const { rows } = await pool.query(
      'INSERT INTO side_bets (description, wager, created_by) VALUES ($1, $2, $3) RETURNING id',
      [description.trim(), (wager || '').trim() || null, req.user.id]
    );
    const betId = rows[0].id;
    const ids = [].concat(participants || []).filter(Boolean).map(Number);
    for (const uid of ids) {
      await pool.query('INSERT INTO side_bet_participants (side_bet_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [betId, uid]);
    }
    res.redirect('/sidebets');
  } catch (err) {
    next(err);
  }
});

router.post('/sidebets/:id/settle', requireAuth, async (req, res, next) => {
  try {
    const { winner_user_id } = req.body;
    await pool.query(
      `UPDATE side_bets SET status = 'settled', winner_user_id = $1 WHERE id = $2`,
      [winner_user_id ? Number(winner_user_id) : null, req.params.id]
    );
    res.redirect('/sidebets');
  } catch (err) {
    next(err);
  }
});

router.post('/sidebets/:id/reopen', requireAuth, async (req, res, next) => {
  try {
    await pool.query(`UPDATE side_bets SET status = 'open', winner_user_id = NULL WHERE id = $1`, [req.params.id]);
    res.redirect('/sidebets');
  } catch (err) {
    next(err);
  }
});

router.post('/sidebets/:id/delete', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM side_bets WHERE id = $1', [req.params.id]);
    const bet = rows[0];
    if (bet && (bet.created_by === req.user.id || req.user.is_admin)) {
      await pool.query('DELETE FROM side_bets WHERE id = $1', [req.params.id]);
    }
    res.redirect('/sidebets');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
