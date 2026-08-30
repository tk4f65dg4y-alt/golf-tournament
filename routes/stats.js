const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth } = require('../src/auth');

const LABELS = {
  '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', '0': 'Par', '1': 'Bogey'
};
function labelForDiff(diff) {
  if (diff <= -3) return 'Albatross';
  if (diff === -2) return 'Eagle';
  if (diff === -1) return 'Birdie';
  if (diff === 0) return 'Par';
  if (diff === 1) return 'Bogey';
  return 'Double+';
}

/** Every individually-scored hole (singles/fourball) that has a known par, across all players. */
async function loadScoredHoles() {
  const { rows } = await pool.query(
    `SELECT phs.user_id, phs.match_id, phs.hole_number, phs.strokes, ch.par, u.name AS user_name,
            r.name AS round_name, m.format
     FROM player_hole_scores phs
     JOIN matches m ON m.id = phs.match_id
     JOIN rounds r ON r.id = m.round_id
     JOIN course_holes ch ON ch.course_id = r.course_id AND ch.hole_number = phs.hole_number
     JOIN users u ON u.id = phs.user_id
     WHERE phs.strokes IS NOT NULL
     ORDER BY r.sort_order, m.sort_order, phs.hole_number`
  );
  for (const row of rows) {
    row.diff = row.strokes - row.par;
    row.label = labelForDiff(row.diff);
  }
  return rows;
}

router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const holes = await loadScoredHoles();
    const byPlayer = {};
    for (const h of holes) {
      if (!byPlayer[h.user_id]) {
        byPlayer[h.user_id] = { userId: h.user_id, name: h.user_name, played: 0, albatross: 0, eagle: 0, birdie: 0, par: 0, bogey: 0, worse: 0, totalDiff: 0 };
      }
      const p = byPlayer[h.user_id];
      p.played++;
      p.totalDiff += h.diff;
      if (h.diff <= -3) p.albatross++;
      else if (h.diff === -2) p.eagle++;
      else if (h.diff === -1) p.birdie++;
      else if (h.diff === 0) p.par++;
      else if (h.diff === 1) p.bogey++;
      else p.worse++;
    }
    const leaderboard = Object.values(byPlayer).sort((a, b) => (b.birdie + b.eagle * 2) - (a.birdie + a.eagle * 2));

    const mostBirdies = [...leaderboard].sort((a, b) => b.birdie - a.birdie)[0];
    const mostEagles = [...leaderboard].filter((p) => p.eagle > 0).sort((a, b) => b.eagle - a.eagle)[0];
    const bestAvg = [...leaderboard].filter((p) => p.played >= 3).sort((a, b) => a.totalDiff / a.played - b.totalDiff / b.played)[0];

    res.render('stats', { leaderboard, mostBirdies, mostEagles, bestAvg, hasAnyData: holes.length > 0 });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
