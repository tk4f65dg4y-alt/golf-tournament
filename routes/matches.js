const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth } = require('../src/auth');
const { computeMatchStatus, computeHandicapAllocation, computeNetHoleWinner, strokesOnHole, TOTAL_HOLES } = require('../src/matchLogic');

const ONE_BALL_FORMATS = new Set(['foursomes', 'scramble']);

async function loadMatchBundle(matchId) {
  const { rows: matchRows } = await pool.query(
    `SELECT m.*, r.name AS round_name, r.id AS round_id, r.course_id
     FROM matches m JOIN rounds r ON r.id = m.round_id WHERE m.id = $1`,
    [matchId]
  );
  if (!matchRows.length) return null;
  const match = matchRows[0];

  const { rows: players } = await pool.query(
    `SELECT mp.side, u.id, u.name, u.handicap, u.is_captain, t.name AS team_name, t.color AS team_color
     FROM match_players mp JOIN users u ON u.id = mp.user_id
     LEFT JOIN teams t ON t.id = u.team_id
     WHERE mp.match_id = $1 ORDER BY mp.side, u.name`,
    [matchId]
  );
  match.side1 = players.filter((p) => p.side === 1);
  match.side2 = players.filter((p) => p.side === 2);
  match.isOneBall = ONE_BALL_FORMATS.has(match.format);

  // Course holes (par + stroke index) power auto handicap scoring. A round
  // without a full 18-hole course falls back to manual hole-winner tapping.
  let courseHoles = [];
  if (match.course_id) {
    const { rows } = await pool.query('SELECT * FROM course_holes WHERE course_id = $1 ORDER BY hole_number', [match.course_id]);
    courseHoles = rows;
  }
  match.hasCourse = courseHoles.length === TOTAL_HOLES;

  const { rows: holes } = await pool.query('SELECT hole_number, winner, entered_by FROM match_holes WHERE match_id = $1', [matchId]);
  const holeByNumber = {};
  for (const h of holes) holeByNumber[h.hole_number] = h;

  const holeList = [];
  if (match.hasCourse) {
    match.allocation = computeHandicapAllocation(match.format, match.side1, match.side2);

    let grossByHoleUser = {};
    let grossByHoleSide = {};
    if (match.isOneBall) {
      const { rows: sideScores } = await pool.query('SELECT side, hole_number, strokes FROM match_side_scores WHERE match_id = $1', [matchId]);
      for (const s of sideScores) {
        grossByHoleSide[s.hole_number] = grossByHoleSide[s.hole_number] || {};
        grossByHoleSide[s.hole_number][s.side] = s.strokes;
      }
    } else {
      const { rows: playerScores } = await pool.query('SELECT user_id, hole_number, strokes FROM player_hole_scores WHERE match_id = $1', [matchId]);
      for (const s of playerScores) {
        grossByHoleUser[s.hole_number] = grossByHoleUser[s.hole_number] || {};
        grossByHoleUser[s.hole_number][s.user_id] = s.strokes;
      }
    }

    for (const ch of courseHoles) {
      holeList.push({
        hole_number: ch.hole_number,
        par: ch.par,
        stroke_index: ch.stroke_index,
        winner: holeByNumber[ch.hole_number] ? holeByNumber[ch.hole_number].winner : null,
        grossByUserId: grossByHoleUser[ch.hole_number] || {},
        grossBySide: grossByHoleSide[ch.hole_number] || {}
      });
    }
    match.strokesGivenByUserId = {};
    match.strokesGivenBySide = {};
    if (match.allocation.byUserId) {
      for (const p of [...match.side1, ...match.side2]) {
        match.strokesGivenByUserId[p.id] = {};
        for (const ch of courseHoles) match.strokesGivenByUserId[p.id][ch.hole_number] = strokesOnHole(match.allocation.byUserId[p.id], ch.stroke_index);
      }
    }
    if (match.allocation.bySide) {
      for (const side of [1, 2]) {
        match.strokesGivenBySide[side] = {};
        for (const ch of courseHoles) match.strokesGivenBySide[side][ch.hole_number] = strokesOnHole(match.allocation.bySide[side], ch.stroke_index);
      }
    }
    match.totalAllowanceByUserId = {};
    if (match.allocation.byUserId) {
      for (const uid of Object.keys(match.allocation.byUserId)) match.totalAllowanceByUserId[uid] = Math.round(match.allocation.byUserId[uid]);
    }
    match.totalAllowanceBySide = {};
    if (match.allocation.bySide) {
      match.totalAllowanceBySide[1] = Math.round(match.allocation.bySide[1]);
      match.totalAllowanceBySide[2] = Math.round(match.allocation.bySide[2]);
    }
  } else {
    for (let h = 1; h <= TOTAL_HOLES; h++) {
      holeList.push({ hole_number: h, par: null, stroke_index: null, winner: holeByNumber[h] ? holeByNumber[h].winner : null });
    }
    // Legacy manual-mode still supports optional per-player strokes for the record.
    const { rows: strokeRows } = await pool.query('SELECT user_id, hole_number, strokes FROM player_hole_scores WHERE match_id = $1', [matchId]);
    match.strokesByHoleUser = {};
    for (const s of strokeRows) match.strokesByHoleUser[`${s.hole_number}_${s.user_id}`] = s.strokes;
  }

  match.statusInfo = computeMatchStatus(holes, Number(match.points));
  match.holeList = holeList;

  return match;
}

function canScore(req, match) {
  if (req.user.is_admin) return true;
  const allIds = [...match.side1, ...match.side2].map((p) => p.id);
  return allIds.includes(req.user.id);
}

router.get('/matches/:id', requireAuth, async (req, res, next) => {
  try {
    const match = await loadMatchBundle(req.params.id);
    if (!match) return res.status(404).render('error', { message: 'Match not found.' });
    res.render('match-detail', { match, canEnter: canScore(req, match) });
  } catch (err) {
    next(err);
  }
});

/** Recompute + persist overall match status from match_holes so leaderboard queries stay cheap. */
async function refreshMatchStatus(matchId, points) {
  const { rows: holes } = await pool.query('SELECT hole_number, winner FROM match_holes WHERE match_id = $1', [matchId]);
  const status = computeMatchStatus(holes, points);
  await pool.query(
    `UPDATE matches SET status = $1, team1_result = $2, team2_result = $3, closed_note = $4 WHERE id = $5`,
    [status.isComplete ? 'complete' : status.thru > 0 ? 'in_progress' : 'scheduled', status.team1Result, status.team2Result, status.closedNote, matchId]
  );
}

async function setHoleWinner(matchId, holeNumber, winner, enteredById) {
  if (winner) {
    await pool.query(
      `INSERT INTO match_holes (match_id, hole_number, winner, entered_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (match_id, hole_number) DO UPDATE SET winner = $3, entered_by = $4, updated_at = now()`,
      [matchId, holeNumber, winner, enteredById]
    );
  } else {
    await pool.query('DELETE FROM match_holes WHERE match_id = $1 AND hole_number = $2', [matchId, holeNumber]);
  }
}

router.post('/matches/:id/hole', requireAuth, async (req, res, next) => {
  try {
    const matchId = req.params.id;
    const match = await loadMatchBundle(matchId);
    if (!match) return res.status(404).render('error', { message: 'Match not found.' });
    if (!canScore(req, match)) return res.status(403).render('error', { message: 'Only players in this match (or an admin) can enter scores.' });

    const holeNumber = Number(req.body.hole_number);
    if (!holeNumber || holeNumber < 1 || holeNumber > TOTAL_HOLES) return res.redirect(`/matches/${matchId}`);

    if (match.hasCourse) {
      const courseHole = match.holeList.find((h) => h.hole_number === holeNumber);

      if (match.isOneBall) {
        const g1raw = req.body.strokes_side1;
        const g2raw = req.body.strokes_side2;
        for (const [side, raw] of [[1, g1raw], [2, g2raw]]) {
          if (raw === '' || raw === undefined) {
            await pool.query('DELETE FROM match_side_scores WHERE match_id = $1 AND side = $2 AND hole_number = $3', [matchId, side, holeNumber]);
          } else {
            const strokes = Number(raw);
            if (Number.isFinite(strokes) && strokes >= 1) {
              await pool.query(
                `INSERT INTO match_side_scores (match_id, side, hole_number, strokes) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (match_id, side, hole_number) DO UPDATE SET strokes = $4`,
                [matchId, side, holeNumber, strokes]
              );
            }
          }
        }
        const { rows: sideRows } = await pool.query('SELECT side, strokes FROM match_side_scores WHERE match_id = $1 AND hole_number = $2', [matchId, holeNumber]);
        const grossBySide = {};
        for (const r of sideRows) grossBySide[r.side] = r.strokes;
        const winner = computeNetHoleWinner({ format: match.format, strokeIndex: courseHole.stroke_index, allocation: match.allocation, grossBySide });
        await setHoleWinner(matchId, holeNumber, winner, req.user.id);
      } else {
        const allPlayers = [...match.side1, ...match.side2];
        for (const p of allPlayers) {
          const raw = req.body[`strokes_${p.id}`];
          if (raw === undefined) continue;
          if (raw === '') {
            await pool.query('DELETE FROM player_hole_scores WHERE match_id = $1 AND user_id = $2 AND hole_number = $3', [matchId, p.id, holeNumber]);
            continue;
          }
          const strokes = Number(raw);
          if (!Number.isFinite(strokes) || strokes < 1) continue;
          await pool.query(
            `INSERT INTO player_hole_scores (match_id, user_id, hole_number, strokes) VALUES ($1, $2, $3, $4)
             ON CONFLICT (match_id, user_id, hole_number) DO UPDATE SET strokes = $4`,
            [matchId, p.id, holeNumber, strokes]
          );
        }
        const { rows: playerRows } = await pool.query('SELECT user_id, strokes FROM player_hole_scores WHERE match_id = $1 AND hole_number = $2', [matchId, holeNumber]);
        const grossByUserId = {};
        for (const r of playerRows) grossByUserId[r.user_id] = r.strokes;
        const winner = computeNetHoleWinner({
          format: match.format,
          strokeIndex: courseHole.stroke_index,
          allocation: match.allocation,
          side1Players: match.side1,
          side2Players: match.side2,
          grossByUserId
        });
        await setHoleWinner(matchId, holeNumber, winner, req.user.id);
      }
    } else {
      // Legacy manual mode: no course assigned to this round.
      const winner = ['team1', 'team2', 'halved'].includes(req.body.winner) ? req.body.winner : null;
      await setHoleWinner(matchId, holeNumber, winner, req.user.id);

      const allPlayers = [...match.side1, ...match.side2];
      for (const p of allPlayers) {
        const raw = req.body[`strokes_${p.id}`];
        if (raw === undefined) continue;
        if (raw === '') {
          await pool.query('DELETE FROM player_hole_scores WHERE match_id = $1 AND user_id = $2 AND hole_number = $3', [matchId, p.id, holeNumber]);
          continue;
        }
        const strokes = Number(raw);
        if (!Number.isFinite(strokes) || strokes < 1) continue;
        await pool.query(
          `INSERT INTO player_hole_scores (match_id, user_id, hole_number, strokes) VALUES ($1, $2, $3, $4)
           ON CONFLICT (match_id, user_id, hole_number) DO UPDATE SET strokes = $4`,
          [matchId, p.id, holeNumber, strokes]
        );
      }
    }

    await refreshMatchStatus(matchId, Number(match.points));
    res.redirect(`/matches/${matchId}#hole-${holeNumber}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
