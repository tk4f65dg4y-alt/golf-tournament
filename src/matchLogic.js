const TOTAL_HOLES = 18;

/**
 * Compute the state of a match-play match from the holes entered so far.
 * @param {Array<{hole_number:number, winner:string}>} holeRows - rows from match_holes for this match
 * @param {number} pointsValue - points awarded to the winning side (e.g. 1, 0.5)
 */
function computeMatchStatus(holeRows, pointsValue) {
  const byHole = {};
  for (const row of holeRows) byHole[row.hole_number] = row.winner;

  let team1Wins = 0;
  let team2Wins = 0;
  let thru = 0;
  let decided = null; // { atHole, diff, remaining }

  for (let h = 1; h <= TOTAL_HOLES; h++) {
    const winner = byHole[h];
    if (!winner) break; // holes are entered in order; stop at first unplayed hole
    thru = h;
    if (winner === 'team1') team1Wins++;
    else if (winner === 'team2') team2Wins++;
    // 'halved' changes neither count

    const remaining = TOTAL_HOLES - h;
    const diff = Math.abs(team1Wins - team2Wins);
    if (!decided && diff > remaining) {
      decided = { atHole: h, diff, remaining };
    }
  }

  const diff = Math.abs(team1Wins - team2Wins);
  const leader = team1Wins === team2Wins ? null : (team1Wins > team2Wins ? 'team1' : 'team2');
  const isComplete = !!decided || thru === TOTAL_HOLES;

  let closedNote = null;
  let winner = null;
  let team1Result = null;
  let team2Result = null;

  if (isComplete) {
    if (diff === 0) {
      closedNote = 'Halved';
      team1Result = pointsValue / 2;
      team2Result = pointsValue / 2;
    } else {
      winner = leader;
      const remaining = decided ? decided.remaining : 0;
      closedNote = remaining > 0 ? `${diff}&${remaining}` : `${diff} UP`;
      team1Result = winner === 'team1' ? pointsValue : 0;
      team2Result = winner === 'team2' ? pointsValue : 0;
    }
  }

  let statusText;
  if (isComplete) {
    statusText = closedNote;
  } else if (thru === 0) {
    statusText = 'Not started';
  } else if (diff === 0) {
    statusText = `All Square thru ${thru}`;
  } else {
    statusText = `${diff} UP thru ${thru}`;
  }

  return {
    totalHoles: TOTAL_HOLES,
    thru,
    team1Wins,
    team2Wins,
    diff,
    leader, // 'team1' | 'team2' | null while in progress or halved
    isComplete,
    closedNote,
    winner, // 'team1' | 'team2' | null (null also covers halved)
    team1Result,
    team2Result,
    statusText
  };
}

/**
 * Standard golf handicap stroke allocation: given a player/side's total
 * strokes-received allowance for the round, how many of those strokes land
 * on one specific hole, based on that hole's stroke index (1 = hardest).
 * e.g. allowance 9 -> one stroke each on the 9 hardest holes (SI 1-9).
 * allowance 22 -> one stroke on every hole, plus a second on SI 1-4.
 */
function strokesOnHole(allowance, strokeIndex) {
  const a = Math.max(0, Math.round(allowance));
  if (a <= 0) return 0;
  const base = Math.floor(a / TOTAL_HOLES);
  const remainder = a % TOTAL_HOLES;
  return base + (strokeIndex <= remainder ? 1 : 0);
}

/**
 * Work out each player's (or each side's) handicap stroke allowance for a
 * match, using the standard "relative to the lowest handicap in the game"
 * method. The formats differ in who the allowance is computed for:
 *  - singles/fourball: each individual player plays off the lowest
 *    individual handicap among everyone in the match.
 *  - foursomes/scramble: it's one ball per side, so each side's playing
 *    handicap is the average of its players' handicaps, and the side with
 *    the higher combined handicap gets strokes relative to the other side.
 *    (This is a simplified approximation of real foursomes/scramble
 *    handicap conventions, which vary by club — easy to adjust later.)
 *
 * @returns for singles/fourball: { byUserId: { [userId]: allowance } }
 *          for foursomes/scramble: { bySide: { 1: allowance, 2: allowance } }
 */
function computeHandicapAllocation(format, side1Players, side2Players) {
  const allPlayers = [...side1Players, ...side2Players];

  if (format === 'foursomes' || format === 'scramble') {
    const sideHandicap = (players) =>
      players.length ? players.reduce((s, p) => s + Number(p.handicap), 0) / players.length : 0;
    const h1 = sideHandicap(side1Players);
    const h2 = sideHandicap(side2Players);
    const ref = Math.min(h1, h2);
    return { bySide: { 1: h1 - ref, 2: h2 - ref } };
  }

  // singles or fourball
  const ref = allPlayers.length ? Math.min(...allPlayers.map((p) => Number(p.handicap))) : 0;
  const byUserId = {};
  for (const p of allPlayers) byUserId[p.id] = Number(p.handicap) - ref;
  return { byUserId };
}

/**
 * Decide the winner of one hole from gross strokes entered, applying each
 * player's/side's handicap allowance for that specific hole (by stroke
 * index) to get net scores, then comparing.
 *
 * @param format 'singles' | 'fourball' | 'foursomes' | 'scramble'
 * @param strokeIndex this hole's difficulty rank (1-18) from the course
 * @param allocation result of computeHandicapAllocation
 * @param side1Players / side2Players match_players rows (id, handicap)
 * @param grossByUserId { [userId]: strokes } — singles/fourball
 * @param grossBySide { 1: strokes, 2: strokes } — foursomes/scramble
 * @returns 'team1' | 'team2' | 'halved' | null (null = not enough data yet)
 */
function computeNetHoleWinner({ format, strokeIndex, allocation, side1Players, side2Players, grossByUserId, grossBySide }) {
  if (format === 'foursomes' || format === 'scramble') {
    const g1 = grossBySide && grossBySide[1];
    const g2 = grossBySide && grossBySide[2];
    if (!g1 || !g2) return null;
    const net1 = g1 - strokesOnHole(allocation.bySide[1], strokeIndex);
    const net2 = g2 - strokesOnHole(allocation.bySide[2], strokeIndex);
    if (net1 === net2) return 'halved';
    return net1 < net2 ? 'team1' : 'team2';
  }

  // singles / fourball: best (lowest) individual net score per side
  const sideNet = (players) => {
    const nets = [];
    for (const p of players) {
      const gross = grossByUserId && grossByUserId[p.id];
      if (!gross) return null; // missing an entry — not ready yet
      nets.push(gross - strokesOnHole(allocation.byUserId[p.id], strokeIndex));
    }
    return nets.length ? Math.min(...nets) : null;
  };

  const net1 = sideNet(side1Players);
  const net2 = sideNet(side2Players);
  if (net1 === null || net2 === null) return null;
  if (net1 === net2) return 'halved';
  return net1 < net2 ? 'team1' : 'team2';
}

module.exports = {
  computeMatchStatus,
  computeHandicapAllocation,
  computeNetHoleWinner,
  strokesOnHole,
  TOTAL_HOLES
};
