-- Golf Tournament schema. Applied idempotently at boot (see src/db.js).

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#1b6b3a'
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  handicap NUMERIC(4,1) NOT NULL DEFAULT 0,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_captain BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migration for databases created before is_captain existed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_captain BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS rounds (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  course TEXT,
  round_date DATE,
  format_note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  format TEXT NOT NULL DEFAULT 'singles', -- singles | fourball | foursomes | scramble
  points NUMERIC(3,1) NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | in_progress | complete
  team1_result NUMERIC(3,1),
  team2_result NUMERIC(3,1),
  closed_note TEXT, -- e.g. "3&2"
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_players (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side INTEGER NOT NULL, -- 1 or 2
  UNIQUE (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS match_holes (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  hole_number INTEGER NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  winner TEXT, -- 'team1' | 'team2' | 'halved' | NULL (not played)
  entered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, hole_number)
);

CREATE TABLE IF NOT EXISTS player_hole_scores (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hole_number INTEGER NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  strokes INTEGER,
  UNIQUE (match_id, user_id, hole_number)
);

CREATE TABLE IF NOT EXISTS side_bets (
  id SERIAL PRIMARY KEY,
  description TEXT NOT NULL,
  wager TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | settled
  winner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS side_bet_participants (
  id SERIAL PRIMARY KEY,
  side_bet_id INTEGER NOT NULL REFERENCES side_bets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (side_bet_id, user_id)
);

CREATE TABLE IF NOT EXISTS photos (
  id SERIAL PRIMARY KEY,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
