// Validates computeMatchState against acceptance checks in spec section 12.
// Run: node test/matchstate.test.js
const assert = require('assert');
const { computeMatchState } = require('../public/js/golf-logic');

let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures++;
    console.error(`FAIL ${label}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

const flatAllocations = (ids, holeCount) => {
  const a = {};
  for (const id of ids) {
    a[id] = {};
    for (let h = 1; h <= holeCount; h++) a[id][h] = 0;
  }
  return a;
};

// --- Closes immediately at 3 up with 2 to play -> "3&2" ---
{
  const match = { format: 'singles', holeCount: 18, sideA: ['a'], sideB: ['b'], points: 1 };
  const alloc = flatAllocations(['a', 'b'], 18);
  const scores = {};
  // A wins holes 1-3, halves 4-15 (16 holes played), leaving A 3up with 2 to play (holes 17,18 not yet played... wait need exactly "3 up with 2 to play" = after 16 holes played, 2 remain)
  for (let h = 1; h <= 3; h++) scores[h] = { a: 4, b: 5 };
  for (let h = 4; h <= 16; h++) scores[h] = { a: 4, b: 4 };
  const state = computeMatchState(match, [], alloc, scores);
  check('3 up thru 16 (2 remaining) closes as 3&2', state.isComplete && state.closedResult === '3&2');
  check('3&2 stops counting extra holes (holesPlayed=16)', state.holesPlayed === 16);
}

// --- Halved match -> "A/S", 0.5 each ---
{
  const match = { format: 'singles', holeCount: 18, sideA: ['a'], sideB: ['b'], points: 1 };
  const alloc = flatAllocations(['a', 'b'], 18);
  const scores = {};
  for (let h = 1; h <= 18; h++) scores[h] = { a: 4, b: 4 };
  const state = computeMatchState(match, [], alloc, scores);
  check('all 18 halved -> A/S', state.closedResult === 'A/S');
  check('halved awards 0.5 each', state.pointsA === 0.5 && state.pointsB === 0.5);
}

// --- Won on the final hole -> "1 up" ---
{
  const match = { format: 'singles', holeCount: 18, sideA: ['a'], sideB: ['b'], points: 1 };
  const alloc = flatAllocations(['a', 'b'], 18);
  const scores = {};
  for (let h = 1; h <= 17; h++) scores[h] = { a: 4, b: 4 };
  scores[18] = { a: 3, b: 4 };
  const state = computeMatchState(match, [], alloc, scores);
  check('win on 18th -> "1 up" (not 1&0)', state.closedResult === '1 up');
}

// --- In-progress display ---
{
  const match = { format: 'singles', holeCount: 18, sideA: ['a'], sideB: ['b'], points: 1 };
  const alloc = flatAllocations(['a', 'b'], 18);
  const scores = {};
  for (let h = 1; h <= 5; h++) scores[h] = { a: 4, b: 4 };
  scores[6] = { a: 3, b: 4 };
  scores[7] = { a: 3, b: 4 };
  const state = computeMatchState(match, [], alloc, scores);
  check('2 up thru 7, not complete', !state.isComplete && state.diff === 2 && state.leadingSide === 'A' && state.holesPlayed === 7);
}

// --- Fourball: picked-up player doesn't count, partner's net still does ---
{
  const match = { format: 'fourball', holeCount: 9, sideA: ['a1', 'a2'], sideB: ['b1', 'b2'], points: 1 };
  const alloc = flatAllocations(['a1', 'a2', 'b1', 'b2'], 9);
  const scores = { 1: { a1: null, a2: 4, b1: 5, b2: 5 } }; // a1 picked up, a2's 4 should still win the hole for side A
  const state = computeMatchState(match, [], alloc, scores);
  check('picked-up player excluded, partner net still counts', state.resultForHole(1) === 'A');
}

// --- Fourball: both players on a side with no score lose the hole ---
{
  const match = { format: 'fourball', holeCount: 9, sideA: ['a1', 'a2'], sideB: ['b1', 'b2'], points: 1 };
  const alloc = flatAllocations(['a1', 'a2', 'b1', 'b2'], 9);
  const scores = { 1: { a1: null, a2: null, b1: 5, b2: 6 } };
  const state = computeMatchState(match, [], alloc, scores);
  check('both picked up on a side -> that side loses the hole', state.resultForHole(1) === 'B');
}

// --- Danny receives no shots in match 6 despite being on 3 (allocation, cross-checked here too) ---
{
  const { matchAllocations } = require('../public/js/golf-logic');
  const { COURSES } = require('../src/data');
  const players = [
    { id: 'cooper', shots: 5 }, { id: 'milo', shots: 8 }, { id: 'danny', shots: 3 }, { id: 'coby', shots: 6 }
  ];
  const alloc = matchAllocations(players, COURSES.village.holes);
  const dannyShots = Object.values(alloc.danny).reduce((s, n) => s + n, 0);
  check('Danny (low man, on 3) receives 0 shots in match 6', dannyShots === 0);
}

if (failures > 0) {
  console.error(`\n${failures} matchState check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll matchState acceptance checks passed.');
