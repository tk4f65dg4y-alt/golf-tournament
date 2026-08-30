require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const { pool, initSchema } = require('./src/db');
const { loadUser } = require('./src/auth');

const authRoutes = require('./routes/auth');
const homeRoutes = require('./routes/home');
const leaderboardRoutes = require('./routes/leaderboard');
const matchRoutes = require('./routes/matches');
const courseRoutes = require('./routes/courses');
const rulesRoutes = require('./routes/rules');
const captainRoutes = require('./routes/captain');
const { router: photoRoutes, uploadDir } = require('./routes/photos');
const sidebetRoutes = require('./routes/sidebets');

const app = express();

// Railway (and most PaaS hosts) terminate HTTPS at an edge proxy and forward
// to the app over plain HTTP. Without this, Express can't tell the request
// was actually HTTPS, so a "secure" session cookie never gets set on the
// browser and every login immediately looks logged-out.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

app.use(
  session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days — nobody should be logging back in on the 14th tee
      // 'auto' checks req.secure, which (thanks to trust proxy above) correctly
      // reflects the original client<->edge connection, not the internal
      // proxy<->app hop. DISABLE_SECURE_COOKIE is an escape hatch for hosts
      // that don't sit behind a TLS-terminating proxy at all.
      secure: process.env.DISABLE_SECURE_COOKIE === 'true' ? false : 'auto'
    }
  })
);

app.use(loadUser);

// Composes the "Casey 2 up thru 7" / "All square thru 4" / "3&2" line for a
// match bundle (from src/matchData.js) — shared across leaderboard/matches views.
app.locals.matchStateText = function (b) {
  const aName = b.sideAPlayers.map((p) => p.name.split(' ')[0]).join('/');
  const bName = b.sideBPlayers.map((p) => p.name.split(' ')[0]).join('/');
  const state = b.state;
  if (state.holesPlayed === 0 && !state.isComplete) return 'Not started';
  if (state.isComplete) {
    if (state.closedResult === 'A/S') return 'Halved, A/S';
    const leader = state.leadingSide === 'A' ? aName : bName;
    return `${leader} win ${state.closedResult}`;
  }
  if (state.leadingSide === null) return `All square thru ${state.holesPlayed}`;
  const leader = state.leadingSide === 'A' ? aName : bName;
  return `${leader} ${state.diff} up thru ${state.holesPlayed}`;
};

app.use(authRoutes);
app.use(homeRoutes);
app.use(leaderboardRoutes);
app.use(matchRoutes);
app.use(courseRoutes);
app.use(rulesRoutes);
app.use(captainRoutes);
app.use(photoRoutes);
app.use(sidebetRoutes);

app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: 'Something went wrong.' });
});

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`The Aldenham Cup site running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
