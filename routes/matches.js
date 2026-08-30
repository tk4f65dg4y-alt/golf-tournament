const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth } = require('../src/auth');
const { computeMatchStatus, TOTAL_HOLES } = require('../src/matchLogic');

async function loadMatchBundle(matchId) {
  const { rows: matchRows } = await pool.query(
    `SELECT m.*, r.name AS round_name, r.id AS round_id FROM matches m
     JOIN rounds r ON r.id = m.round_id WHERE m.id = $1`,
    [matchId]
  );
  if (!matchRows.length) return null;
  const match = matchRows[0];

  const { rows: players } = await pool.query(
    `SELECT mp.side, u.id, u.name, t.name AS team_name, t.color AS team_color
     FROM match_players mp JOIN users u ON u.id = mp.user_id
     LEFT JOIN teams t ON t.id = u.team_id
     WHERE mp.match_id = $1 ORDER BY mp.side, u.name`,
    [matchId]
  );
  match.side1 = players.filter((p) => p.side === 1);
  match.side2 = players.filter((p) => p.side === 2);

  const { rows: holes } = await pool.query(
    'SELECT hole_number, winner, entered_by FROM match_holes WHERE match_id = $1',
    [matchId]
  );
  const holeByNumber = {};
  for (const h of holes) holeByNumber[h.hole_number] = h;

  const { rows: strokeRows } = await pool.query(
    'SELECT user_id, hole_number, strokes FROM player_hole_scores WHERE match_id = $1',
    [matchId]
  );
  const strokesByHoleUser = {};
  for (const s of strokeRows) strokesByHoleUser[`${s.hole_number}_${s.user_id}`] = s.strokes;

  const holeList = [];
  for (let h = 1; h <= TOTAL_HOLES; h++) {
    holeList.push({ hole_number: h, winner: holeByNumber[h] ? holeByNumber[h].winner : null });
  }

  match.statusInfo = computeMatchStatus(holes, Number(match.points));
  match.holeList = holeList;
  match.strokesByHoleUser = strokesByHoleUser;

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

router.post('/matches/:id/hole', requireAuth, async (req, res, next) => {
  try {
    const matchId = req.params.id;
    const match = await loadMatchBundle(matchId);
    if (!match) return res.status(404).render('error', { message: 'Match not found.' });
    if (!canScore(req, match)) return res.status(403).render('error', { message: 'Only players in this match (or an admin) can enter scores.' });

    const holeNumber = Number(req.body.hole_number);
    if (!holeNumber || holeNumber < 1 || holeNumber > TOTAL_HOLES) {
      return res.redirect(`/matches/${matchId}`);
    }
    const winner = ['team1', 'team2', 'halved'].includes(req.body.winner) ? req.body.winner : null;

    if (winner) {
      await pool.query(
        `INSERT INTO match_holes (match_id, hole_number, winner, entered_by, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (match_id, hole_number)
         DO UPDATE SET winner = $3, entered_by = $4, updated_at = now()`,
        [matchId, holeNumber, winner, req.user.id]
      );
    } else {
      await pool.query('DELETE FROM match_holes WHERE match_id = $1 AND hole_number = $2', [matchId, holeNumber]);
    }

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
        `INSERT INTO player_hole_scores (match_id, user_id, hole_number, strokes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (match_id, user_id, hole_number) DO UPDATE SET strokes = $4`,
        [matchId, p.id, holeNumber, strokes]
      );
    }

    // Recompute + persist match status so leaderboard queries stay cheap.
    const { rows: holes } = await pool.query('SELECT hole_number, winner FROM match_holes WHERE match_id = $1', [matchId]);
    const status = computeMatchStatus(holes, Number(match.points));
    await pool.query(
      `UPDATE matches SET status = $1, team1_result = $2, team2_result = $3, closed_note = $4 WHERE id = $5`,
      [status.isComplete ? 'complete' : (status.thru > 0 ? 'in_progress' : 'scheduled'), status.team1Result, status.team2Result, status.closedNote, matchId]
    );

    res.redirect(`/matches/${matchId}#hole-${holeNumber}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
