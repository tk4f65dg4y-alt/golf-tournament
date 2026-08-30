const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth, requirePlayer } = require('../src/auth');
const { PLAYERS, findPlayer } = require('../src/data');

function nameOf(playerId) {
  const p = findPlayer(playerId);
  return p ? p.name : null;
}

async function loadBets() {
  const { rows: bets } = await pool.query(`SELECT * FROM side_bets ORDER BY status ASC, created_at DESC`);
  for (const b of bets) {
    b.created_by_name = nameOf(b.created_by);
    b.winner_name = nameOf(b.winner_player_id);
    const { rows: participantRows } = await pool.query('SELECT player_id FROM side_bet_participants WHERE side_bet_id = $1', [b.id]);
    b.participants = participantRows.map((r) => ({ id: r.player_id, name: nameOf(r.player_id) })).filter((p) => p.name);
  }
  return bets;
}

router.get('/sidebets', requireAuth, async (req, res, next) => {
  try {
    const bets = await loadBets();
    res.render('sidebets', { bets, players: PLAYERS });
  } catch (err) {
    next(err);
  }
});

router.post('/sidebets', requirePlayer, async (req, res, next) => {
  try {
    const { description, wager, participants } = req.body;
    if (!description || !description.trim()) return res.redirect('/sidebets');
    const { rows } = await pool.query(
      'INSERT INTO side_bets (description, wager, created_by) VALUES ($1, $2, $3) RETURNING id',
      [description.trim(), (wager || '').trim() || null, req.user.id]
    );
    const betId = rows[0].id;
    const ids = [].concat(participants || []).filter(Boolean);
    for (const pid of ids) {
      await pool.query('INSERT INTO side_bet_participants (side_bet_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [betId, pid]);
    }
    res.redirect('/sidebets');
  } catch (err) {
    next(err);
  }
});

router.post('/sidebets/:id/settle', requirePlayer, async (req, res, next) => {
  try {
    const { winner_player_id } = req.body;
    await pool.query(
      `UPDATE side_bets SET status = 'settled', winner_player_id = $1 WHERE id = $2`,
      [winner_player_id || null, req.params.id]
    );
    res.redirect('/sidebets');
  } catch (err) {
    next(err);
  }
});

router.post('/sidebets/:id/reopen', requirePlayer, async (req, res, next) => {
  try {
    await pool.query(`UPDATE side_bets SET status = 'open', winner_player_id = NULL WHERE id = $1`, [req.params.id]);
    res.redirect('/sidebets');
  } catch (err) {
    next(err);
  }
});

router.post('/sidebets/:id/delete', requirePlayer, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM side_bets WHERE id = $1', [req.params.id]);
    const bet = rows[0];
    if (bet && (bet.created_by === req.user.id || req.user.isCaptain)) {
      await pool.query('DELETE FROM side_bets WHERE id = $1', [req.params.id]);
    }
    res.redirect('/sidebets');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
