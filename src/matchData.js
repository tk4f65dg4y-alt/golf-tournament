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

/** Load the optional performance stats for a match as { holeNumber: { playerId: { putts, fairwayHit, gir } } }. */
async function loadStats(matchId) {
  const { rows } = await pool.query('SELECT hole_number, player_id, putts, fairway_hit, gir FROM scores WHERE match_id = $1', [matchId]);
  const stats = {};
  for (const r of rows) {
    stats[r.hole_number] = stats[r.hole_number] || {};
    stats[r.hole_number][r.player_id] = { putts: r.putts, fairwayHit: r.fairway_hit, gir: r.gir };
  }
  return stats;
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
  const stats = await loadStats(matchId);
  const state = computeMatchState(match, courseHoles, allocations, scores);

  return { match, course, courseHoles, sideAPlayers, sideBPlayers, allPlayers, allocations, scores, entryMeta, stats, state };
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

/** Is the Cup itself decided yet? First to 3.5 wins; a recorded sudden_death row also settles it. */
function cupStatus(bundles, suddenDeathRow) {
  const scores = teamScores(bundles);
  const tiedAt3 = scores.confirmed.casey === 3 && scores.confirmed.reggel === 3 && bundles.every((b) => b.state.isComplete);
  let winnerTeam = null;
  if (suddenDeathRow) winnerTeam = suddenDeathRow.winner_team;
  else if (scores.confirmed.casey >= 3.5) winnerTeam = 'casey';
  else if (scores.confirmed.reggel >= 3.5) winnerTeam = 'reggel';
  return { scores, cupDecided: !!winnerTeam, winnerTeam, tiedAt3 };
}

/**
 * Individual performance stats across every match a player's in (each
 * player plays exactly two: one singles + one fourball). Birdies/pars/
 * bogeys are always classified off the gross score (the standard golf
 * meaning of the term); `scoring` only picks which total ("to par") the
 * table is ranked and displayed by.
 */
function buildPerformanceData(bundles, scoring) {
  const byPlayer = {};

  for (const b of bundles) {
    for (const p of b.allPlayers) {
      const row =
        byPlayer[p.id] ||
        (byPlayer[p.id] = {
          player: p,
          holesPlayed: 0,
          grossTotal: 0,
          netTotal: 0,
          parTotal: 0,
          puttsTotal: 0,
          puttsCount: 0,
          fairwaysHit: 0,
          fairwaysCount: 0,
          girHit: 0,
          girCount: 0,
          eagleOrBetter: 0,
          birdies: 0,
          pars: 0,
          bogeys: 0,
          doubleOrWorse: 0
        });

      for (const ch of b.courseHoles) {
        const gross = b.scores[ch.number] ? b.scores[ch.number][p.id] : undefined;
        if (gross === undefined || gross === null) continue; // not entered, or picked up

        const shots = (b.allocations[p.id] && b.allocations[p.id][ch.number]) || 0;
        const net = gross - shots;

        row.holesPlayed += 1;
        row.grossTotal += gross;
        row.netTotal += net;
        row.parTotal += ch.par;

        const toPar = gross - ch.par;
        if (toPar <= -2) row.eagleOrBetter += 1;
        else if (toPar === -1) row.birdies += 1;
        else if (toPar === 0) row.pars += 1;
        else if (toPar === 1) row.bogeys += 1;
        else row.doubleOrWorse += 1;

        const s = b.stats[ch.number] && b.stats[ch.number][p.id];
        if (s) {
          if (typeof s.putts === 'number') {
            row.puttsTotal += s.putts;
            row.puttsCount += 1;
          }
          // Fairway-hit isn't a meaningful stat on a par 3 (you're aiming at
          // the green off the tee, not a fairway) -- excluded either way.
          if (ch.par !== 3 && typeof s.fairwayHit === 'boolean') {
            row.fairwaysCount += 1;
            if (s.fairwayHit) row.fairwaysHit += 1;
          }
          if (typeof s.gir === 'boolean') {
            row.girCount += 1;
            if (s.gir) row.girHit += 1;
          }
        }
      }
    }
  }

  const rows = Object.values(byPlayer).map((row) => ({
    ...row,
    grossToPar: row.holesPlayed ? row.grossTotal - row.parTotal : null,
    netToPar: row.holesPlayed ? row.netTotal - row.parTotal : null,
    puttsAvg: row.puttsCount ? row.puttsTotal / row.puttsCount : null,
    fairwayPct: row.fairwaysCount ? Math.round((row.fairwaysHit / row.fairwaysCount) * 100) : null,
    girPct: row.girCount ? Math.round((row.girHit / row.girCount) * 100) : null
  }));

  const key = scoring === 'net' ? 'netToPar' : 'grossToPar';
  rows.sort((a, b) => {
    if (a[key] === null && b[key] === null) return 0;
    if (a[key] === null) return 1; // no holes played yet -- sink to the bottom
    if (b[key] === null) return -1;
    return a[key] - b[key]; // lower (fewer strokes over par) is better
  });

  return rows;
}

module.exports = { loadScores, loadEntryMeta, buildMatchBundle, buildAllMatchBundles, teamScores, cupStatus, buildPerformanceData };
