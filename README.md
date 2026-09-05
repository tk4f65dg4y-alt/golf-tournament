# ⛳ The Aldenham Cup

Live scoring for match play between the same 8 players, across two real
courses, real handicap shots, offline-capable scoring from each player's
phone, and an overall leaderboard. Any combination of the 8 can start a new
match against each other at any time — there's no fixed draw.

## Setup

**Everything fixed about the event — players, PINs, and the two
courses/scorecards — lives in one file: [`src/data.js`](src/data.js).**
That's the only place anyone needs to edit (e.g. to change a PIN). Matches
themselves aren't fixed in code at all: anyone can start one from the app
(see Matches below), and it's stored in the database. The one other
exception is the rules text: it starts as a copy of the `RULES` list in
`src/data.js`, but from first boot onward it lives in the database and is
editable by a captain from the app itself (see Captain tools below) —
editing the file after that has no effect.

The shot-allocation and match-scoring logic lives in
[`public/js/golf-logic.js`](public/js/golf-logic.js) — loaded both by the
server (Node) and the browser (offline scoring), so client and server always
agree. It's pinned down against every fixture in the spec:

```bash
node test/allocation.test.js
node test/matchstate.test.js
```

## How it works

- **Login** — tap your name, enter your 4-digit PIN. No email, no
  passwords. A read-only Spectator account is also seeded — no PIN needed
  for that one, it logs straight in.
- **Today** — the top of the overall leaderboard, a link straight into
  your current match (or a button to start a new one), the day's timings,
  and a live "Moments" feed (hole wins, birdies, closed matches) generated
  entirely from the scores already being entered — no extra logging needed.
- **Matches** — start a new match against any combination of the 8 players,
  any time (pick a course, put each player on a side); every match ever
  played is listed here too, each with its full shot allocation and a
  hole-by-hole grid.
- **Scoring** — one hole at a time, built to survive patchy course signal:
  every tap writes to the browser's local storage immediately and queues a
  background sync, so a lost bar of signal on the 13th never loses a score.
  Once the page has loaded, the whole match (all holes) can be scored with
  zero network at all — it only needs a connection again to sync back up.
- **Leaderboard** — everyone ranked by overall win/loss/half record across
  every match they've played, regardless of who it was against — a win is
  worth 1 point, a half 0.5.
- **Courses / Rules** — both scorecards and the printed rules, for reference
  mid-round. The rules themselves are editable (see Captain tools below),
  not fixed in code.
- **Captain tools** (Casey & Reggel only) — edit the day's timings, reset a
  match's scores (or every match's), manually override one hole's score,
  and rewrite/add/remove any rule on the Rules page whenever needed.
- **Performance** — a live individual leaderboard built from the stats
  captured alongside each score: putts, fairways hit, and greens in
  regulation, plus birdies/pars/bogeys derived from gross vs. par. Toggle
  between gross and net. Updates as scores come in, same as the main
  leaderboard.
- **Awards** — live superlatives derived from the same data: Best Round
  (gross and net), Most Birdies, Best Putter, Biggest Comeback, Biggest Win
  Margin. Always "so far", since there's no fixed end to the tracker.
- **Photos** — everyone gets one vote for their favourite shot (voting for a
  different one just moves it); the current leader gets a "Photo of the
  day" badge, live.

## Local development

```bash
npm install
cp .env.example .env      # then edit DATABASE_URL for your local Postgres
node test/allocation.test.js && node test/matchstate.test.js
npm start
```

The app creates its own tables on boot (`migrations/schema.sql`) — a fresh
empty Postgres database is all it needs. Players and courses come straight
from `src/data.js` at request time; matches are created from the app itself
and live in the database.

## Deploying (Railway)

1. Create a Railway project from this repo, attach a **PostgreSQL** database
   (wires `DATABASE_URL` in automatically).
2. Add a **volume** mounted at `UPLOAD_DIR` (default `/app/uploads`) so
   uploaded photos survive redeploys.
3. Set `SESSION_SECRET` and `NODE_ENV=production` on the app service.
4. Deploy, then share the URL — everyone logs in with their name + PIN from
   `src/data.js`.
