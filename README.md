# ⛳ The Aldenham Cup

Live scoring for a one-day, eight-player Ryder Cup style golf day: 27 holes
of match play across two courses, real handicap shots, offline-capable
scoring from each player's phone, and a live leaderboard.

## Before the day

**Everything about the event — players, PINs, courses, the draw, shot
counts — lives in one file: [`src/data.js`](src/data.js).** That's the only
place anyone needs to edit before the day (e.g. to change a PIN). Nothing
else in the app needs configuring.

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
  passwords. A read-only Spectator account is also seeded, plus a no-PIN
  **/bet-in** link for anyone who just wants to bet.
- **Today** — the team score (confirmed + projected), a link straight into
  your next hole, and the day's timings.
- **Scoring** — one hole at a time, built to survive patchy course signal:
  every tap writes to the browser's local storage immediately and queues a
  background sync, so a lost bar of signal on the 13th never loses a score.
  Once the page has loaded, the whole match (all holes) can be scored with
  zero network at all — it only needs a connection again to sync back up.
- **Leaderboard** — confirmed team score plus a projected score that credits
  the side currently ahead in every in-progress match.
- **Matches** — the full shot allocation and a hole-by-hole grid for every match.
- **Courses / Rules** — both scorecards and the printed rules, for reference
  mid-round.
- **Captain tools** (Casey & Reggel only) — edit the day's timings, reset a
  match's scores, or manually override one hole's score, plus recording a
  sudden-death result if the Cup finishes tied 3–3.
- **Bets** — matched 1-v-1 prop bets for anyone, playing or not: Cup winner,
  match winner, hole winner (in-play — bet on a hole before it's played),
  over/under gross or net pars, or a fully custom claim. A proposer backs a
  claim with a stake, someone else takes the other side, and structured
  bets settle themselves the instant the real result posts (even mid-hole);
  custom ones are settled by a captain. Share `/bet-in` with friends who
  aren't playing — no PIN needed.

## Local development

```bash
npm install
cp .env.example .env      # then edit DATABASE_URL for your local Postgres
node test/allocation.test.js && node test/matchstate.test.js
npm start
```

The app creates its own tables on boot (`migrations/schema.sql`) — a fresh
empty Postgres database is all it needs. There's no admin setup flow:
players, courses and matches are all seeded from `src/data.js` at request
time, not written to the database.

## Deploying (Railway)

1. Create a Railway project from this repo, attach a **PostgreSQL** database
   (wires `DATABASE_URL` in automatically).
2. Add a **volume** mounted at `UPLOAD_DIR` (default `/app/uploads`) so
   uploaded photos survive redeploys.
3. Set `SESSION_SECRET` and `NODE_ENV=production` on the app service.
4. Deploy, then share the URL — everyone logs in with their name + PIN from
   `src/data.js`.
