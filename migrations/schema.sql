-- The Aldenham Cup. Players, courses, matches, teams, and PINs are all
-- hardcoded in src/data.js — that's the one file to edit before the day.
-- The database only holds what actually changes during play.

-- Previous generic-tournament-app tables that have no equivalent in this
-- schema at all (safe to drop unconditionally — nothing ever recreates them
-- under these names, so after the first boot this is a permanent no-op).
DROP TABLE IF EXISTS match_side_scores CASCADE;
DROP TABLE IF EXISTS player_hole_scores CASCADE;
DROP TABLE IF EXISTS match_holes CASCADE;
DROP TABLE IF EXISTS match_players CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS course_holes CASCADE;
DROP TABLE IF EXISTS courses CASCADE;
DROP TABLE IF EXISTS rounds CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS rulings CASCADE; -- AI Rules Official, removed

-- photos / side_bets / side_bet_participants keep the same names in the new
-- schema too (just with text player ids instead of integer user ids), so
-- dropping them unconditionally on every boot would wipe real event data on
-- every restart. Only drop+recreate if the OLD (integer) column is still
-- there; once migrated this block is a permanent no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'photos' AND column_name = 'uploaded_by' AND data_type = 'integer'
  ) THEN
    DROP TABLE IF EXISTS side_bet_participants CASCADE;
    DROP TABLE IF EXISTS side_bets CASCADE;
    DROP TABLE IF EXISTS photos CASCADE;
  END IF;
END $$;

-- One row per player per hole per match. Absence of a row = not entered
-- yet. picked_up = true (gross NULL) = deliberately no score for that hole.
CREATE TABLE IF NOT EXISTS scores (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL,
  hole_number INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  gross INTEGER,
  picked_up BOOLEAN NOT NULL DEFAULT FALSE,
  entered_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, hole_number, player_id)
);

-- The day's schedule. Seeded empty — filled in closer to the day.
CREATE TABLE IF NOT EXISTS timings (
  id SERIAL PRIMARY KEY,
  time TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Sudden death only happens if the Cup is tied 3-3 after all six matches.
CREATE TABLE IF NOT EXISTS sudden_death (
  id SERIAL PRIMARY KEY,
  winner_team TEXT, -- 'casey' | 'reggel'
  recorded_by TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Photos and side bets, carried over from the earlier build (adapted to
-- text player ids instead of a users table).
CREATE TABLE IF NOT EXISTS photos (
  id SERIAL PRIMARY KEY,
  uploaded_by TEXT,
  filename TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS side_bets (
  id SERIAL PRIMARY KEY,
  description TEXT NOT NULL,
  wager TEXT,
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | settled
  winner_player_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS side_bet_participants (
  id SERIAL PRIMARY KEY,
  side_bet_id INTEGER NOT NULL REFERENCES side_bets(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  UNIQUE (side_bet_id, player_id)
);

-- Matched 1-v-1 prop bets, open to players, spectators and the no-PIN
-- bettor guest alike. Every wager is a single proposed claim ("Casey wins
-- Hole 7"): the proposer backs it, whoever matches takes the other side of
-- exactly that claim. Structured kinds (cup/match/hole/pars) settle
-- themselves the moment the real result exists -- checked lazily on each
-- page load (see src/wagers.js) rather than a background job, which is
-- what makes hole-level bets genuinely live/in-play. 'custom' kind has no
-- real data to check against, so a captain settles it by hand.
CREATE TABLE IF NOT EXISTS wagers (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL, -- cup | match | hole | pars | custom
  claim TEXT NOT NULL, -- human-readable, e.g. "Casey wins Hole 7 (Match 1)"

  -- structured reference fields -- only the ones relevant to `kind` are set
  ref_match_id INTEGER,
  ref_hole_number INTEGER,
  ref_side TEXT, -- 'A' | 'B' | 'half' -- the side/outcome the proposer is backing
  ref_player_id TEXT,
  ref_line NUMERIC, -- e.g. 84.5
  ref_over_under TEXT, -- 'over' | 'under'
  ref_score_type TEXT, -- 'gross' | 'net'

  stake_amount NUMERIC NOT NULL,
  stake_unit TEXT NOT NULL DEFAULT '£',

  proposer_name TEXT NOT NULL,
  matcher_name TEXT,

  status TEXT NOT NULL DEFAULT 'open', -- open | matched | settled | void
  result TEXT, -- proposer_won | matcher_won
  settle_note TEXT, -- how/why it settled, shown in the feed

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  matched_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ
);
