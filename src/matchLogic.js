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

module.exports = { computeMatchStatus, TOTAL_HOLES };
