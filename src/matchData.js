const { pool } = require('./db');
const { COURSES, MATCHES, findPlayer, findMatch, shotsFor } = require('./data');
const { matchAllocations, computeMatchState } = require('../public/js/golf-logic');

/**
 * Load raw score rows for a match as { holeNumber: { playerId: gross|null } }
 * (undefined = not entered). A hole with an unresolved conflict (two
 * different people entered two different numbers) counts as not entered
 * here too -- it stays out of the match result until a captain resolves it,
 * same as a genuinely-unscored hole.
 */
async function loadScores(matchId) {
  const { rows } = await pool.query('SELECT hole_number, player_id, gross, picked_up, conflict_gross FROM scores WHERE match_id = $1', [matchId]);
  const scores = {};
  for (const r of rows) {
    scores[r.hole_number] = scores[r.hole_number] || {};
    scores[r.hole_number][r.player_id] = r.picked_up ? null : (r.conflict_gross !== null ? undefined : r.gross);
  }
  return scores;
}

/** Load any unresolved score conflicts for a match as { holeNumber: { playerId: { gross, enteredBy, conflictGross, conflictEnteredBy } } }. */
async function loadConflicts(matchId) {
  const { rows } = await pool.query(
    `SELECT hole_number, player_id, gross, entered_by, conflict_gross, conflict_entered_by
     FROM scores WHERE match_id = $1 AND conflict_gross IS NOT NULL`,
    [matchId]
  );
  const conflicts = {};
  for (const r of rows) {
    conflicts[r.hole_number] = conflicts[r.hole_number] || {};
    conflicts[r.hole_number][r.player_id] = {
      gross: r.gross,
      enteredBy: r.entered_by,
      conflictGross: r.conflict_gross,
      conflictEnteredBy: r.conflict_entered_by
    };
  }
  return conflicts;
}

async function loadResetAt(matchId) {
  const { rows } = await pool.query('SELECT reset_at FROM match_resets WHERE match_id = $1', [matchId]);
  return rows[0] ? rows[0].reset_at : null;
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
  const conflicts = await loadConflicts(matchId);
  const resetAt = await loadResetAt(matchId);
  const state = computeMatchState(match, courseHoles, allocations, scores);

  return { match, course, courseHoles, sideAPlayers, sideBPlayers, allPlayers, allocations, scores, entryMeta, stats, conflicts, resetAt, state };
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

/**
 * A chronological "what just happened" feed, entirely derived from data
 * already being scored -- no separate event log to keep in sync. Every
 * moment gets its timestamp from the scores that decided it (`updated_at`),
 * so ordering is exact even across matches running at different paces.
 */
function buildMomentsFeed(bundles, cupInfo, suddenDeathRow, limit) {
  const moments = [];
  const sideName = (b, side) => (side === 'A' ? b.sideAPlayers : b.sideBPlayers).map((p) => p.name).join(' & ');
  let latestTs = null;
  const noteTs = (ts) => {
    if (ts && (!latestTs || new Date(ts) > new Date(latestTs))) latestTs = ts;
  };

  for (const b of bundles) {
    for (const ch of b.courseHoles) {
      const result = b.state.resultForHole(ch.number);
      if (result === undefined) continue;

      const metaForHole = b.entryMeta[ch.number] || {};
      const holeTs = Object.values(metaForHole).map((m) => m.updatedAt).filter(Boolean).sort().pop();
      if (holeTs) {
        noteTs(holeTs);
        const text = result === 'half'
          ? `Hole ${ch.number} halved — Match ${b.match.id}, ${sideName(b, 'A')} v ${sideName(b, 'B')}`
          : `${sideName(b, result)} win Hole ${ch.number} — Match ${b.match.id}`;
        moments.push({ ts: holeTs, icon: '⛳', text });
      }

      for (const p of b.allPlayers) {
        const gross = b.scores[ch.number] ? b.scores[ch.number][p.id] : undefined;
        if (gross === undefined || gross === null) continue;
        const toPar = gross - ch.par;
        if (toPar > -1) continue; // birdie or better only -- pars/bogeys aren't "moments"
        const ts = (metaForHole[p.id] && metaForHole[p.id].updatedAt) || holeTs;
        if (!ts) continue;
        noteTs(ts);
        const eagle = toPar <= -2;
        moments.push({ ts, icon: eagle ? '🦅' : '🐦', text: `${p.name} makes ${eagle ? 'an eagle' : 'a birdie'} on Hole ${ch.number} — Match ${b.match.id}` });
      }
    }

    if (b.state.isComplete) {
      const allTs = [];
      for (const h of Object.values(b.entryMeta)) for (const m of Object.values(h)) if (m.updatedAt) allTs.push(m.updatedAt);
      const ts = allTs.sort().pop();
      if (ts) {
        noteTs(ts);
        const text = b.state.leadingSide === null
          ? `Match ${b.match.id} closes halved, A/S`
          : `${sideName(b, b.state.leadingSide)} win Match ${b.match.id} ${b.state.closedResult}`;
        moments.push({ ts, icon: '🏁', text });
      }
    }
  }

  if (cupInfo.cupDecided) {
    const ts = (suddenDeathRow && suddenDeathRow.recorded_at) || latestTs;
    if (ts) {
      const teamName = cupInfo.winnerTeam === 'casey' ? 'Team Casey' : 'Team Reggel';
      moments.push({ ts, icon: '🏆', text: `${teamName} win The Aldenham Cup!` });
    }
  }

  moments.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return typeof limit === 'number' ? moments.slice(0, limit) : moments;
}

/**
 * End-of-day (but live, so "so far" until the Cup's actually decided)
 * superlatives. Reuses buildPerformanceData for the totals-based awards;
 * comeback and win-margin are computed directly off each match's
 * hole-by-hole results since they need the match's whole shape, not just
 * its final state.
 */
function buildAwards(bundles) {
  const grossRows = buildPerformanceData(bundles, 'gross').filter((r) => r.holesPlayed > 0);
  const netRows = buildPerformanceData(bundles, 'net').filter((r) => r.holesPlayed > 0);

  const bestRoundGross = grossRows[0] || null; // already sorted best-first
  const bestRoundNet = netRows[0] || null;

  const putters = grossRows.filter((r) => r.puttsCount > 0).sort((a, b) => a.puttsAvg - b.puttsAvg);
  const bestPutter = putters[0] || null;

  const birdiest = grossRows
    .map((r) => ({ ...r, birdiesPlus: r.eagleOrBetter + r.birdies }))
    .filter((r) => r.birdiesPlus > 0)
    .sort((a, b) => b.birdiesPlus - a.birdiesPlus);
  const mostBirdies = birdiest[0] || null;

  let biggestComeback = null;
  let biggestWinMargin = null;

  for (const b of bundles) {
    if (!b.state.isComplete || b.state.leadingSide === null) continue; // halved matches have no winner to award

    if (!biggestWinMargin || b.state.diff > biggestWinMargin.diff) {
      biggestWinMargin = {
        diff: b.state.diff,
        matchId: b.match.id,
        players: (b.state.leadingSide === 'A' ? b.sideAPlayers : b.sideBPlayers).map((p) => p.name).join(' & '),
        closedResult: b.state.closedResult
      };
    }

    // Walk the decided holes in order, tracking the running score, to find
    // how far behind the eventual winner ever fell.
    let diff = 0; // positive = side A up
    let minDiff = 0;
    let maxDiff = 0;
    for (const r of b.state.results) {
      if (r.holeNumber > b.state.holesPlayed) break;
      if (r.winner === 'A') diff += 1;
      else if (r.winner === 'B') diff -= 1;
      minDiff = Math.min(minDiff, diff);
      maxDiff = Math.max(maxDiff, diff);
    }
    const deficit = b.state.leadingSide === 'A' ? -minDiff : maxDiff;
    if (deficit > 0 && (!biggestComeback || deficit > biggestComeback.deficit)) {
      biggestComeback = {
        deficit,
        matchId: b.match.id,
        players: (b.state.leadingSide === 'A' ? b.sideAPlayers : b.sideBPlayers).map((p) => p.name).join(' & '),
        closedResult: b.state.closedResult
      };
    }
  }

  return { bestRoundGross, bestRoundNet, bestPutter, mostBirdies, biggestComeback, biggestWinMargin };
}

module.exports = { loadScores, loadEntryMeta, buildMatchBundle, buildAllMatchBundles, teamScores, cupStatus, buildPerformanceData, buildMomentsFeed, buildAwards };
