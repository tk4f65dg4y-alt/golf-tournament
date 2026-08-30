/**
 * Aldenham Cup scoring logic — shot allocation + match state.
 * Single source of truth, loaded both server-side (Node, via require) and
 * client-side (plain <script>, as window.GolfLogic) so the offline scoring
 * screen computes exactly the same result the server would.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.GolfLogic = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Shot allocation (spec section 4) ----

  function allocate(courseHoles, shots) {
    const order = courseHoles.slice().sort((a, b) => a.strokeIndex - b.strokeIndex); // hardest first
    const allocation = {};
    for (const h of courseHoles) allocation[h.number] = 0;
    for (let i = 0; i < shots; i++) {
      const hole = order[i % order.length];
      allocation[hole.number] += 1;
    }
    return allocation;
  }

  function matchAllocations(players, courseHoles) {
    const low = Math.min.apply(Math, players.map((p) => p.shots));
    const result = {};
    for (const p of players) result[p.id] = allocate(courseHoles, p.shots - low);
    return result;
  }

  // ---- Net scores + hole results (spec section 6) ----
  // gross: undefined = not entered yet, null = picked up / conceded, number = gross strokes.

  function netFor(gross, shotsOnHole) {
    if (gross === undefined) return undefined;
    if (gross === null) return null;
    return gross - shotsOnHole;
  }

  /**
   * @param {'singles'|'fourball'} format
   * @param {string[]} sideAIds, sideBIds
   * @param {Object} allocations - { playerId: { holeNumber: shots } }
   * @param {Object} holeScores - { playerId: gross|null|undefined } for this one hole
   * @param {number} holeNumber
   * @returns {'A'|'B'|'half'|undefined} undefined = not enough data yet
   */
  function resolveHole(format, sideAIds, sideBIds, allocations, holeScores, holeNumber) {
    function net(playerId) {
      const gross = holeScores[playerId];
      const shots = (allocations[playerId] && allocations[playerId][holeNumber]) || 0;
      return netFor(gross, shots);
    }

    if (format === 'singles') {
      const a = net(sideAIds[0]);
      const b = net(sideBIds[0]);
      if (a === undefined || b === undefined) return undefined;
      const av = a === null ? Infinity : a;
      const bv = b === null ? Infinity : b;
      if (av === Infinity && bv === Infinity) return 'half';
      if (av === bv) return 'half';
      return av < bv ? 'A' : 'B';
    }

    // fourball: pair score = best (lowest) net among players with a real number.
    // A side is "ready" once neither of its players is still undefined.
    function sideReady(ids) {
      return ids.every((id) => net(id) !== undefined);
    }
    if (!sideReady(sideAIds) || !sideReady(sideBIds)) return undefined;

    function sideScore(ids) {
      const nums = ids.map(net).filter((n) => n !== null && n !== undefined);
      return nums.length ? Math.min.apply(Math, nums) : Infinity; // both picked up -> effectively loses the hole
    }
    const av = sideScore(sideAIds);
    const bv = sideScore(sideBIds);
    if (av === Infinity && bv === Infinity) return 'half';
    if (av === bv) return 'half';
    return av < bv ? 'A' : 'B';
  }

  function formatClosed(diff, remaining) {
    if (diff === 0) return 'A/S';
    if (remaining > 0) return `${diff}&${remaining}`;
    return `${diff} up`;
  }

  /**
   * @param {Object} match - { format, holeCount, sideA: string[], sideB: string[] }
   * @param {Array<{number:number, strokeIndex:number}>} courseHoles
   * @param {Object} allocations - { playerId: { holeNumber: shots } }
   * @param {Object} scores - { holeNumber: { playerId: gross|null } }
   */
  function computeMatchState(match, courseHoles, allocations, scores) {
    let upA = 0;
    let holesPlayed = 0;
    let decided = null;
    const results = [];

    for (let h = 1; h <= match.holeCount; h++) {
      const holeScores = scores[h] || {};
      const winner = resolveHole(match.format, match.sideA, match.sideB, allocations, holeScores, h);
      if (winner === undefined) break;
      holesPlayed = h;
      if (winner === 'A') upA++;
      else if (winner === 'B') upA--;
      results.push({ holeNumber: h, winner });

      const remaining = match.holeCount - h;
      const diff = Math.abs(upA);
      if (!decided && diff > remaining) decided = { atHole: h, diff, remaining };
    }
    for (let h = holesPlayed + 1; h <= match.holeCount; h++) results.push({ holeNumber: h, winner: undefined });

    const diff = Math.abs(upA);
    const leadingSide = upA === 0 ? null : upA > 0 ? 'A' : 'B';
    const isComplete = !!decided || holesPlayed === match.holeCount;

    let closedResult = null;
    let pointsA = null;
    let pointsB = null;
    if (isComplete) {
      const remaining = decided ? decided.remaining : 0;
      closedResult = formatClosed(diff, remaining);
      if (diff === 0) {
        pointsA = match.points / 2;
        pointsB = match.points / 2;
      } else {
        pointsA = leadingSide === 'A' ? match.points : 0;
        pointsB = leadingSide === 'B' ? match.points : 0;
      }
    }

    // Provisional points for the leaderboard: confirmed once closed, otherwise
    // whoever's currently ahead gets the point, half each if all square.
    let projectedA;
    let projectedB;
    if (isComplete) {
      projectedA = pointsA;
      projectedB = pointsB;
    } else if (leadingSide === null) {
      projectedA = match.points / 2;
      projectedB = match.points / 2;
    } else {
      projectedA = leadingSide === 'A' ? match.points : 0;
      projectedB = leadingSide === 'B' ? match.points : 0;
    }

    return {
      holesPlayed,
      diff,
      leadingSide,
      isComplete,
      closedResult,
      pointsA,
      pointsB,
      projectedA,
      projectedB,
      results,
      // for the scoring screen's per-hole "who won" line
      resultForHole(holeNumber) {
        const r = results.find((x) => x.holeNumber === holeNumber);
        return r ? r.winner : undefined;
      }
    };
  }

  return { allocate, matchAllocations, resolveHole, computeMatchState, netFor, formatClosed };
});
