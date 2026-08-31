const { PLAYERS, SPECTATOR, TEAMS, findPlayer } = require('./data');

/** Attaches req.user / res.locals.user (or null) based on the session. Runs on every request. */
function loadUser(req, res, next) {
  const playerId = req.session && req.session.playerId;
  const player = playerId ? findPlayer(playerId) : null;
  if (!player) {
    req.user = null;
    res.locals.user = null;
    return next();
  }
  req.user = { ...player, team: player.team ? TEAMS[player.team] : null };
  res.locals.user = req.user;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

/** Blocks anyone who isn't one of the 8 real players from scoring/photos/side-bet routes. */
function requirePlayer(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.readOnly) return res.status(403).render('error', { message: 'Spectators can watch, not score.' });
  next();
}

function requireCaptain(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (!req.user.isCaptain) return res.status(403).render('error', { message: 'Captains only.' });
  next();
}

module.exports = { PLAYERS, SPECTATOR, loadUser, requireAuth, requirePlayer, requireCaptain };
