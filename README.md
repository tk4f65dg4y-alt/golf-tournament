# ⛳ Golf Tournament

A live scoring site for a friends' Ryder Cup–style golf trip: two teams,
match play points, hole-by-hole scoring entered from players' phones, a
roster with handicaps, a photo gallery, and a side-bet tracker.

## Stack

- Node.js + Express, server-rendered with EJS (works great on spotty course wifi — plain forms, no client build step)
- PostgreSQL for data (teams, users, rounds, matches, hole-by-hole results, photos, side bets)
- Session-based login (`express-session` + `connect-pg-simple`), gated by a shared invite code
- Photo uploads via `multer` to local disk (mount a volume in production so they persist)

## How it works

- **Teams & players** — an admin creates two teams and assigns each registered
  friend to one, with their handicap.
- **Rounds & matches** — an admin creates rounds (e.g. "Day 1 — Fourball") and,
  within each, individual matches (singles / fourball / foursomes / scramble),
  assigning players to each side and a points value.
- **Live scoring** — any player in a match (or an admin) can open its
  scorecard and record the winner of each hole as it's played (Team A / Halved
  / Team B), with optional gross-stroke entry per player for the record book.
  The match status ("2 UP thru 7", "3&2", etc.) and the overall team score on
  the leaderboard update immediately from that.
- **Leaderboard** — the home page shows the running team point totals plus
  live/upcoming/completed matches, like a mini Ryder Cup tracker.
- **Photos & side bets** — everyone can upload trip photos and start/settle
  friendly side wagers.

## Local development

```bash
npm install
cp .env.example .env      # then edit values, especially DATABASE_URL
npm start
```

The app creates its database tables automatically on boot (see
`migrations/schema.sql`), so a fresh empty Postgres database is all you need.

The **first account ever registered becomes an admin** automatically. Use
that account to create your two teams under **Admin**, then set up rounds
and matches under **Rounds**.

## Deploying (Railway)

1. Create a new Railway project from this repo.
2. Add a **PostgreSQL** database to the project — Railway wires `DATABASE_URL`
   into the app service automatically.
3. Add a **volume** mounted at the path you set for `UPLOAD_DIR` (default
   `/app/uploads`) so uploaded photos survive redeploys.
4. Set environment variables on the app service: `SESSION_SECRET`,
   `INVITE_CODE`, `SITE_NAME`, `NODE_ENV=production`.
5. Deploy. Register the first account (it becomes admin), share the invite
   code with your friends, and set up teams/rounds.

## Environment variables

See `.env.example` for the full list and explanations.
