const express = require('express');
const router = express.Router();
const { PLAYERS, SPECTATOR, findPlayer } = require('../src/data');

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { players: PLAYERS, spectator: SPECTATOR, selected: null, error: null });
});

router.get('/login/:id', (req, res) => {
  if (req.user) return res.redirect('/');
  const player = findPlayer(req.params.id);
  if (!player) return res.redirect('/login');
  res.render('login', { players: PLAYERS, spectator: SPECTATOR, selected: player, error: null });
});

router.post('/login/:id', (req, res) => {
  if (req.user) return res.redirect('/');
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
