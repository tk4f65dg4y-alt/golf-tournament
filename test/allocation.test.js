// Validates the shot allocation rule: every player plays off their own raw
// course handicap in every match, fixed relative to Casey (0, scratch) --
// never re-based to whoever's lowest in a given pairing. Only Casey ever
// plays scratch; everyone else brings their real handicap into every match,
// including matches Casey isn't even in.
// Run: node test/allocation.test.js
const assert = require('assert');
const { COURSES, PLAYERS, shotsFor, findPlayer } = require('../src/data');
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

// --- Church Course, 1v1 pairings ---
function singlesAllocations(idA, idB, courseId) {
  const players = [idA, idB].map((id) => {
    const p = findPlayer(id);
    return { id, shots: shotsFor(p, courseId) };
  });
  return matchAllocations(players, COURSES[courseId].holes);
}

let alloc = singlesAllocations('casey', 'reggel', 'church');
check('Casey v Reggel — Casey receives', holesWithShots(alloc.casey), []);
check('Casey v Reggel — Reggel receives', holesWithShots(alloc.reggel), [4, 10, 13]);

alloc = singlesAllocations('milo', 'coby', 'church');
check('Milo v Coby — Milo receives (raw 15, not re-based to Coby)', holesWithShots(alloc.milo), [13, 4, 10, 1, 11, 7, 17, 9, 15, 3, 18, 6, 12, 8, 16]);
check('Milo v Coby — Coby receives (raw 12, not 0 — only Casey plays scratch)', holesWithShots(alloc.coby), [13, 4, 10, 1, 11, 7, 17, 9, 15, 3, 18, 6]);

alloc = singlesAllocations('cooper', 'danny', 'church');
check('Cooper v Danny — Cooper receives (raw 10, not re-based to Danny)', holesWithShots(alloc.cooper), [13, 4, 10, 1, 11, 7, 17, 9, 15, 3]);
check('Cooper v Danny — Danny receives (raw 6, not 0)', holesWithShots(alloc.danny), [13, 4, 10, 1, 11, 7]);

alloc = singlesAllocations('jamie', 'solly', 'church');
check('Jamie v Solly — Jamie receives (raw 18 — one shot every hole)', holesWithShots(alloc.jamie), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
check('Jamie v Solly — Solly single-stroke holes (raw 24)', holesWithShots(alloc.solly), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
check('Jamie v Solly — Solly double-stroke holes', holesWithAtLeast(alloc.solly, 2), [13, 4, 10, 1, 11, 7]);

// --- The Village, 2v2 pairings ---
function fourballAllocations(sideAIds, sideBIds) {
  const ids = [...sideAIds, ...sideBIds];
  const players = ids.map((id) => {
    const p = findPlayer(id);
    return { id, shots: shotsFor(p, 'village') };
  });
  return matchAllocations(players, COURSES.village.holes);
}

alloc = fourballAllocations(['casey', 'jamie'], ['reggel', 'solly']);
check('Casey/Jamie v Reggel/Solly — Casey receives', holesWithShots(alloc.casey), []);
check('Casey/Jamie v Reggel/Solly — Jamie receives (one each)', holesWithShots(alloc.jamie), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
check('Casey/Jamie v Reggel/Solly — Reggel receives', holesWithShots(alloc.reggel), [5, 9]);
check('Casey/Jamie v Reggel/Solly — Solly single-stroke holes', holesWithShots(alloc.solly), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
check('Casey/Jamie v Reggel/Solly — Solly double-stroke holes', holesWithAtLeast(alloc.solly, 2), [2, 5, 9]);

// Cooper/Milo v Danny/Coby has no Casey in it at all -- everyone still plays
// their own raw village handicap (5/8/3/6), not re-based to Danny even
// though he's the lowest of the four here.
alloc = fourballAllocations(['cooper', 'milo'], ['danny', 'coby']);
check('Cooper/Milo v Danny/Coby — Cooper receives (raw 5)', holesWithShots(alloc.cooper), [9, 5, 2, 8, 6]);
check('Cooper/Milo v Danny/Coby — Milo receives (raw 8)', holesWithShots(alloc.milo), [9, 5, 2, 8, 6, 3, 1, 4]);
check('Cooper/Milo v Danny/Coby — Danny receives (raw 3, not 0)', holesWithShots(alloc.danny), [9, 5, 2]);
check('Cooper/Milo v Danny/Coby — Coby receives (raw 6)', holesWithShots(alloc.coby), [9, 5, 2, 8, 6, 3]);

// --- Overall totals from section 2 ---
function total(key) {
  return PLAYERS.reduce((s, p) => s + p[key], 0);
}
assert.strictEqual(total('shotsChurch'), 88, `Church shots total should be 88, got ${total('shotsChurch')}`);
assert.strictEqual(total('shotsVillage'), 45, `Village shots total should be 45, got ${total('shotsVillage')}`);
console.log('ok   overall totals: Church 88, Village 45');

if (failures > 0) {
  console.error(`\n${failures} allocation check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll allocation fixtures passed.');
