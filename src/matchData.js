const { pool } = require('./db');
const { COURSES, MATCHES, findPlayer, findMatch, shotsFor } = require('./data');
const { matchAllocations, computeMatchState } = require('../public/js/golf-logic');

/** Load raw score rows for a match as { holeNumber: { playerId: gross|null } } (undefined = not entered). */
async function loadScores(matchId) {
  const { rows } = await pool.query('SELECT hole_number, player_id, gross, picked_up FROM scores WHERE match_id = $1', [matchId]);
  const scores = {};
  for (const r of rows) {
    scores[r.hole_number] = scores[r.hole_number] || {};
    scores[r.hole_number][r.player_id] = r.picked_up ? null : r.gross;
  }
  return scores;
}

async function loadEntryMeta(matchId) {
  const { rows } = await pool.query('SELECT hole_number, player_id, entered_by, updated_at FROM scores WHERE match_id = $1', [matchId]);
  const meta = {};
  for (const r of rows) {
    meta[r.hole_number] = meta[r.hole_number] || {};
    meta[r.hole_number][r.player_id] = { enteredBy: r.entered_by, updatedAt: r.updated_at };
  }
  return meta;
}

/** Full bundle for a match: config + players + course + allocations + live state. */
async function buildMatchBundle(matchId) {
  const match = findMatch(matchId);
  if (!match) return null;
  const course = COURSES[match.courseId];
  const courseHoles = course.holes.slice(0, match.holeCount);

  const sideAPlayers = match.sideA.map(findPlayer);
  const sideBPlayers = match.sideB.map(findPlayer);
  const allPlayers = [...sideAPlayers, ...sideBPlayers];

  const allocPlayers = allPlayers.map((p) => ({ id: p.id, shots: shotsFor(p, match.courseId) }));
  const allocations = matchAllocations(allocPlayers, courseHoles);

  const scores = await loadScores(matchId);
  const entryMeta = await loadEntryMeta(matchId);
  const state = computeMatchState(match, courseHoles, allocations, scores);

  return { match, course, courseHoles, sideAPlayers, sideBPlayers, allPlayers, allocations, scores, entryMeta, state };
}

async function buildAllMatchBundles() {
  return Promise.all(MATCHES.map((m) => buildMatchBundle(m.id)));
}

// The draw always puts Team Casey on side A and Team Reggel on side B (see
// src/data.js MATCHES) — that's what lets team scoring just sum by side
// rather than re-deriving team membership from each player on every match.
function teamScores(bundles) {
  const totals = { confirmed: { casey: 0, reggel: 0 }, projected: { casey: 0, reggel: 0 } };
  for (const b of bundles) {
    totals.confirmed.casey += b.state.pointsA || 0;
    totals.confirmed.reggel += b.state.pointsB || 0;
    totals.projected.casey += b.state.projectedA || 0;
    totals.projected.reggel += b.state.projectedB || 0;
  }
  return totals;
}

module.exports = { loadScores, loadEntryMeta, buildMatchBundle, buildAllMatchBundles, teamScores };
