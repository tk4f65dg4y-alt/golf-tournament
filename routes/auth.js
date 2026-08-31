const express = require('express');
const router = express.Router();
const { PLAYERS, SPECTATOR, BETTOR, findPlayer } = require('../src/data');

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { players: PLAYERS, spectator: SPECTATOR, selected: null, error: null });
});

// No PIN — one tap in for anyone who just wants to bet. Must come before
// the generic /login/:id route below so 'bettor' never falls into the PIN flow.
router.get('/bet-in', (req, res) => {
  if (req.user) return res.redirect('/');
  req.session.playerId = BETTOR.id;
  res.redirect('/bets');
});

router.get('/login/:id', (req, res) => {
  if (req.user) return res.redirect('/');
  if (req.params.id === BETTOR.id) return res.redirect('/bet-in');
  const player = findPlayer(req.params.id);
  if (!player) return res.redirect('/login');
  res.render('login', { players: PLAYERS, spectator: SPECTATOR, selected: player, error: null });
});

router.post('/login/:id', (req, res) => {
  if (req.user) return res.redirect('/');
  if (req.params.id === BETTOR.id) return res.redirect('/bet-in');
  const player = findPlayer(req.params.id);
  if (!player) return res.redirect('/login');
  const pin = (req.body.pin || '').trim();
  if (pin !== player.pin) {
    return res.render('login', { players: PLAYERS, spectator: SPECTATOR, selected: player, error: 'Wrong PIN — try again.' });
  }
  req.session.playerId = player.id;
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
