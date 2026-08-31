const { findMatch, findPlayer, TEAMS } = require('./data');
const { netFor } = require('../public/js/golf-logic');

const sideLabel = (side) => (side === 'half' ? 'Halved' : side === 'A' ? 'A' : 'B');

/** Human-readable side name for a match ("Casey" / "Reggel & Solly" / "Halved"). */
function sideName(bundle, side) {
  if (side === 'half') return 'Halved';
  const players = side === 'A' ? bundle.sideAPlayers : bundle.sideBPlayers;
  return players.map((p) => p.name).join(' & ');
}

/** Builds the human-readable claim text at creation time, from the raw form fields. */
function describeClaim(kind, f) {
  if (kind === 'cup') {
    return `${TEAMS[f.side === 'A' ? 'casey' : 'reggel'].name} win the Cup`;
  }
  if (kind === 'match') {
    const bundle = f.bundle;
    return `${sideName(bundle, f.side)} win Match ${bundle.match.id}`;
  }
  if (kind === 'hole') {
    const bundle = f.bundle;
    return `${sideName(bundle, f.side)} win Hole ${f.holeNumber} (Match ${bundle.match.id})`;
  }
  if (kind === 'pars') {
    const player = findPlayer(f.playerId);
    const match = findMatch(f.matchId);
    return `${player.name}'s ${f.scoreType} over Match ${match.id} is ${f.overUnder.toUpperCase()} ${f.line}`;
  }
  return f.claim; // custom
}

/**
 * Checks whether a wager's real-world outcome is now known. Returns null if
 * still undecided, or { result: 'proposer_won'|'matcher_won', note } once resolvable.
 * Only structured kinds (not 'custom') are auto-checked here.
 */
function checkSettlement(wager, bundlesById, cupInfo) {
  if (wager.kind === 'cup') {
    if (!cupInfo.cupDecided) return null;
    const actualSide = cupInfo.winnerTeam === 'casey' ? 'A' : 'B';
    const proposerWon = wager.ref_side === actualSide;
    return { result: proposerWon ? 'proposer_won' : 'matcher_won', note: `${TEAMS[cupInfo.winnerTeam].name} won the Cup` };
  }

  if (wager.kind === 'match') {
    const bundle = bundlesById[wager.ref_match_id];
    if (!bundle || !bundle.state.isComplete) return null;
    const actual = bundle.state.closedResult === 'A/S' ? 'half' : bundle.state.leadingSide;
    const proposerWon = wager.ref_side === actual;
    return { result: proposerWon ? 'proposer_won' : 'matcher_won', note: `Match ${bundle.match.id}: ${sideName(bundle, actual)} won ${bundle.state.closedResult}` };
  }

  if (wager.kind === 'hole') {
    const bundle = bundlesById[wager.ref_match_id];
    if (!bundle) return null;
    const actual = bundle.state.resultForHole(wager.ref_hole_number);
    if (actual === undefined) return null;
    const proposerWon = wager.ref_side === actual;
    return { result: proposerWon ? 'proposer_won' : 'matcher_won', note: `Hole ${wager.ref_hole_number}: ${sideName(bundle, actual)}` };
  }

  if (wager.kind === 'pars') {
    const bundle = bundlesById[wager.ref_match_id];
    if (!bundle) return null;
    let total = 0;
    for (const ch of bundle.courseHoles) {
      const gross = bundle.scores[ch.number] && bundle.scores[ch.number][wager.ref_player_id];
      if (typeof gross !== 'number') return null; // a hole is missing a real score (or was picked up) — can't settle yet
      const shots = (bundle.allocations[wager.ref_player_id] && bundle.allocations[wager.ref_player_id][ch.number]) || 0;
      total += wager.ref_score_type === 'net' ? netFor(gross, shots) : gross;
    }
    const actual = total > Number(wager.ref_line) ? 'over' : 'under';
    const proposerWon = wager.ref_over_under === actual;
    const player = findPlayer(wager.ref_player_id);
    return { result: proposerWon ? 'proposer_won' : 'matcher_won', note: `${player.name} shot ${total} ${wager.ref_score_type} (line ${wager.ref_line})` };
  }

  return null; // 'custom' — captain settles by hand
}

module.exports = { describeClaim, checkSettlement, sideName, sideLabel };
