// Validates the shot allocation rule: every player plays off their own raw
// course handicap in every match, fixed relative to Casey (0, scratch) --
// never re-based to whoever's lowest in a given pairing. Only Casey ever
// plays scratch; everyone else brings their real handicap into every match,
// including matches Casey isn't even in.
// Run: node test/allocation.test.js
const assert = require('assert');
const { COURSES, PLAYERS, MATCHES, shotsFor, findPlayer } = require('../src/data');
const { matchAllocations } = require('../public/js/golf-logic');

let failures = 0;
function check(label, actualSet, expectedHoles) {
  const expected = new Set(expectedHoles);
  const actual = new Set(actualSet);
  const same = actual.size === expected.size && [...expected].every((h) => actual.has(h));
  if (!same) {
    failures++;
    console.error(`FAIL ${label}: expected {${[...expected].sort((a, b) => a - b)}}, got {${[...actual].sort((a, b) => a - b)}}`);
  } else {
    console.log(`ok   ${label}: {${[...actual].sort((a, b) => a - b)}}`);
  }
}
function holesWithShots(allocation) {
  return Object.entries(allocation).filter(([, n]) => n > 0).map(([h]) => Number(h));
}
function holesWithAtLeast(allocation, n) {
  return Object.entries(allocation).filter(([, count]) => count >= n).map(([h]) => Number(h));
}

// --- Morning singles, Church Course ---
function singlesAllocations(matchId, courseId) {
  const match = MATCHES.find((m) => m.id === matchId);
  const players = [match.sideA[0], match.sideB[0]].map((id) => {
    const p = findPlayer(id);
    return { id, shots: shotsFor(p, courseId) };
  });
  return matchAllocations(players, COURSES[courseId].holes);
}

let alloc = singlesAllocations(1, 'church');
check('Match 1 — Casey receives', holesWithShots(alloc.casey), []);
check('Match 1 — Reggel receives', holesWithShots(alloc.reggel), [4, 10, 13]);

alloc = singlesAllocations(2, 'church');
check('Match 2 — Milo receives (raw 15, not re-based to Coby)', holesWithShots(alloc.milo), [13, 4, 10, 1, 11, 7, 17, 9, 15, 3, 18, 6, 12, 8, 16]);
check('Match 2 — Coby receives (raw 12, not 0 — only Casey plays scratch)', holesWithShots(alloc.coby), [13, 4, 10, 1, 11, 7, 17, 9, 15, 3, 18, 6]);

alloc = singlesAllocations(3, 'church');
check('Match 3 — Cooper receives (raw 10, not re-based to Danny)', holesWithShots(alloc.cooper), [13, 4, 10, 1, 11, 7, 17, 9, 15, 3]);
check('Match 3 — Danny receives (raw 6, not 0)', holesWithShots(alloc.danny), [13, 4, 10, 1, 11, 7]);

alloc = singlesAllocations(4, 'church');
check('Match 4 — Jamie receives (raw 18 — one shot every hole)', holesWithShots(alloc.jamie), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
check('Match 4 — Solly single-stroke holes (raw 24)', holesWithShots(alloc.solly), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
check('Match 4 — Solly double-stroke holes', holesWithAtLeast(alloc.solly, 2), [13, 4, 10, 1, 11, 7]);

// --- Afternoon fourball, The Village ---
function fourballAllocations(matchId) {
  const match = MATCHES.find((m) => m.id === matchId);
  const ids = [...match.sideA, ...match.sideB];
  const players = ids.map((id) => {
    const p = findPlayer(id);
    return { id, shots: shotsFor(p, 'village') };
  });
  return matchAllocations(players, COURSES.village.holes);
}

alloc = fourballAllocations(5);
check('Match 5 — Casey receives', holesWithShots(alloc.casey), []);
check('Match 5 — Jamie receives (one each)', holesWithShots(alloc.jamie), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
check('Match 5 — Reggel receives', holesWithShots(alloc.reggel), [5, 9]);
check('Match 5 — Solly single-stroke holes', holesWithShots(alloc.solly), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
check('Match 5 — Solly double-stroke holes', holesWithAtLeast(alloc.solly, 2), [2, 5, 9]);

// Match 6 has no Casey in it at all -- everyone still plays their own raw
// village handicap (5/8/3/6), not re-based to Danny even though he's the
// lowest of the four here.
alloc = fourballAllocations(6);
check('Match 6 — Cooper receives (raw 5)', holesWithShots(alloc.cooper), [9, 5, 2, 8, 6]);
check('Match 6 — Milo receives (raw 8)', holesWithShots(alloc.milo), [9, 5, 2, 8, 6, 3, 1, 4]);
check('Match 6 — Danny receives (raw 3, not 0)', holesWithShots(alloc.danny), [9, 5, 2]);
check('Match 6 — Coby receives (raw 6)', holesWithShots(alloc.coby), [9, 5, 2, 8, 6, 3]);

// --- Team totals from section 2 ---
function teamTotal(team, key) {
  return PLAYERS.filter((p) => p.team === team).reduce((s, p) => s + p[key], 0);
}
assert.strictEqual(teamTotal('casey', 'shotsChurch'), 43, `Team Casey Church total should be 43, got ${teamTotal('casey', 'shotsChurch')}`);
assert.strictEqual(teamTotal('reggel', 'shotsChurch'), 45, `Team Reggel Church total should be 45, got ${teamTotal('reggel', 'shotsChurch')}`);
assert.strictEqual(teamTotal('casey', 'shotsVillage'), 22, `Team Casey Village total should be 22, got ${teamTotal('casey', 'shotsVillage')}`);
assert.strictEqual(teamTotal('reggel', 'shotsVillage'), 23, `Team Reggel Village total should be 23, got ${teamTotal('reggel', 'shotsVillage')}`);
console.log('ok   team totals: Casey 43/22, Reggel 45/23');

if (failures > 0) {
  console.error(`\n${failures} allocation check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll allocation fixtures passed.');
