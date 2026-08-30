// Validates src/allocation.js against every fixture in the spec (section 4).
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
check('Match 2 — Milo receives', holesWithShots(alloc.milo), [4, 10, 13]);
check('Match 2 — Coby receives', holesWithShots(alloc.coby), []);

alloc = singlesAllocations(3, 'church');
check('Match 3 — Cooper receives', holesWithShots(alloc.cooper), [1, 4, 10, 13]);
check('Match 3 — Danny receives', holesWithShots(alloc.danny), []);

alloc = singlesAllocations(4, 'church');
check('Match 4 — Jamie receives', holesWithShots(alloc.jamie), []);
check('Match 4 — Solly receives', holesWithShots(alloc.solly), [1, 4, 7, 10, 11, 13]);

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

alloc = fourballAllocations(6);
check('Match 6 — Cooper receives', holesWithShots(alloc.cooper), [5, 9]);
check('Match 6 — Milo receives', holesWithShots(alloc.milo), [2, 5, 6, 8, 9]);
check('Match 6 — Danny receives', holesWithShots(alloc.danny), []);
check('Match 6 — Coby receives', holesWithShots(alloc.coby), [2, 5, 9]);

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
