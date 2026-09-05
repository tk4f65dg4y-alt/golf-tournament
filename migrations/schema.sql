-- The Aldenham Cup. Players, courses, matches, teams, and PINs are all
-- hardcoded in src/data.js — that's the one file to edit before the day.
-- The database only holds what actually changes during play.

-- Previous generic-tournament-app tables that have no equivalent in this
-- schema at all (safe to drop unconditionally — nothing ever recreates them
-- under these names, so after the first boot this is a permanent no-op).
DROP TABLE IF EXISTS match_side_scores CASCADE;
DROP TABLE IF EXISTS player_hole_scores CASCADE;
DROP TABLE IF EXISTS match_holes CASCADE;
DROP TABLE IF EXISTS course_holes CASCADE;
DROP TABLE IF EXISTS courses CASCADE;
DROP TABLE IF EXISTS rounds CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS rulings CASCADE; -- AI Rules Official, removed
DROP TABLE IF EXISTS wagers CASCADE; -- matched 1v1 betting, removed
DROP TABLE IF EXISTS side_bet_participants CASCADE; -- Side Bets, removed
DROP TABLE IF EXISTS side_bets CASCADE; -- Side Bets, removed
DROP TABLE IF EXISTS sudden_death CASCADE; -- fixed-draw Cup format, removed

-- photos keeps the same name in the new schema too (just with a text
-- player id instead of an integer user id), so dropping it unconditionally
-- on every boot would wipe real event data on every restart. Only
-- drop+recreate if the OLD (integer) column is still there; once migrated
-- this block is a permanent no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'photos' AND column_name = 'uploaded_by' AND data_type = 'integer'
  ) THEN
    DROP TABLE IF EXISTS photos CASCADE;
  END IF;
END $$;

-- One row per player per hole per match. Absence of a row = not entered
-- yet. picked_up = true (gross NULL) = deliberately no score for that hole.
-- putts/fairway_hit/gir are optional performance stats captured alongside
-- the score -- all nullable, since only gross is required to actually
-- settle a hole.
--
-- conflict_gross etc.: since anyone in a match can enter anyone's score
-- (handy when only one player has signal), two different people can enter
-- two different numbers for the same hole. Rather than silently letting
-- the second submission overwrite the first, that second value lands in
-- conflict_gross instead -- the hole stays flagged and out of the match
-- result until a captain resolves it (src/matchData.js treats a conflicted
-- hole as not-yet-entered for scoring purposes).
CREATE TABLE IF NOT EXISTS scores (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL,
  hole_number INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  gross INTEGER,
  picked_up BOOLEAN NOT NULL DEFAULT FALSE,
  putts INTEGER, -- number of putts taken on this hole
  fairway_hit BOOLEAN, -- NULL = not applicable (e.g. a par 3) or not recorded
  gir BOOLEAN, -- green in regulation
  entered_by TEXT,
  conflict_gross INTEGER,
  conflict_entered_by TEXT,
  conflict_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, hole_number, player_id)
);

-- scores existed before putts/fairway_hit/gir/conflict_* were added --
-- backfill the columns onto any table that's missing them so existing
-- deployments don't need a manual migration.
ALTER TABLE scores ADD COLUMN IF NOT EXISTS putts INTEGER;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS fairway_hit BOOLEAN;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS gir BOOLEAN;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS conflict_gross INTEGER;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS conflict_entered_by TEXT;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS conflict_at TIMESTAMPTZ;

-- Bumped every time a captain resets a match's scores. The offline-first
-- scoring screen caches everything in localStorage for resilience against
-- patchy signal, so a server-side wipe needs an explicit signal like this
-- one -- otherwise a phone that already had the page open just keeps
-- showing (and re-syncing) the old scores forever, since there's nothing
-- in a "the server now has fewer rows" response to say "those were deleted
-- on purpose", as opposed to "nobody's gotten to them yet".
CREATE TABLE IF NOT EXISTS match_resets (
  match_id INTEGER PRIMARY KEY,
  reset_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The day's schedule. Seeded empty — filled in closer to the day.
CREATE TABLE IF NOT EXISTS timings (
  id SERIAL PRIMARY KEY,
  time TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Any of the 8 players can start a new match against any other combination
-- of them, at any time -- there's no more fixed draw. A match just names a
-- course, how many holes, and which player is on which side; scores/state
-- are all derived from the scores table as before.
CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  course_id TEXT NOT NULL,
  hole_count INTEGER NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_players (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  side TEXT NOT NULL, -- 'A' | 'B'
  UNIQUE (match_id, player_id)
);

-- Photos, carried over from the earlier build (adapted to a text player id
-- instead of a users table).
CREATE TABLE IF NOT EXISTS photos (
  id SERIAL PRIMARY KEY,
  uploaded_by TEXT,
  filename TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One vote per person (not per photo) -- voting for a different photo just
-- moves your vote, it doesn't add a second one. Whoever's currently ahead
-- is "Photo of the day" on the Photos page, live.
CREATE TABLE IF NOT EXISTS photo_votes (
  id SERIAL PRIMARY KEY,
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Editable rules. Casey and Reggel can rewrite/add/remove these live from
-- the Captain page -- the public Rules page just reads whatever's here.
-- Seeded once from the RULES constant in src/data.js the first time this
-- table is empty (see src/db.js) so there's sensible content from boot,
-- but after that the database is the source of truth, not the constant.
CREATE TABLE IF NOT EXISTS rules (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
