const express = require('express');
const router = express.Router();
const { pool } = require('../src/db');
const { requireAuth, requireBettor, requireCaptain } = require('../src/auth');
const { PLAYERS, findMatch, findPlayer } = require('../src/data');
const { buildAllMatchBundles, cupStatus } = require('../src/matchData');
const { describeClaim, checkSettlement } = require('../src/wagers');

/** Loads every wager, auto-settling any structured one whose real result now exists. */
async function loadWagersAndSettle() {
  const bundles = await buildAllMatchBundles();
  const bundlesById = {};
  for (const b of bundles) bundlesById[b.match.id] = b;
  const { rows: suddenDeathRows } = await pool.query('SELECT * FROM sudden_death ORDER BY id DESC LIMIT 1');
  const cupInfo = cupStatus(bundles, suddenDeathRows[0] || null);

  const { rows: wagers } = await pool.query('SELECT * FROM wagers ORDER BY created_at DESC');

  for (const w of wagers) {
    if (w.status !== 'matched') continue; // only live matched bets can auto-settle
    if (w.kind === 'custom') continue; // captain settles these by hand
    const outcome = checkSettlement(w, bundlesById, cupInfo);
    if (!outcome) continue;
    await pool.query(
      `UPDATE wagers SET status = 'settled', result = $1, settle_note = $2, settled_at = now() WHERE id = $3`,
      [outcome.result, outcome.note, w.id]
    );
    w.status = 'settled';
    w.result = outcome.result;
    w.settle_note = outcome.note;
  }

  return { wagers, bundles, bundlesById, cupInfo };
}

router.get('/bets', requireAuth, async (req, res, next) => {
  try {
    const { wagers, bundles } = await loadWagersAndSettle();
    const open = wagers.filter((w) => w.status === 'open');
    const matched = wagers.filter((w) => w.status === 'matched');
    const settled = wagers.filter((w) => w.status === 'settled' || w.status === 'void');
    const matchOptions = bundles.map((b) => ({
      id: b.match.id,
      label: `${b.sideAPlayers.map((p) => p.name).join(' & ')} v ${b.sideBPlayers.map((p) => p.name).join(' & ')}`,
      holeCount: b.match.holeCount
    }));
    res.render('bets', { open, matched, settled, matchOptions, players: PLAYERS, error: null, defaultName: req.user.bettorOnly ? '' : req.user.name });
  } catch (err) {
    next(err);
  }
});

router.post('/bets', requireBettor, async (req, res, next) => {
  try {
    const { kind, stakeAmount, stakeUnit, proposerName } = req.body;
    const amount = Number(stakeAmount);
    const name = (proposerName || '').trim().slice(0, 40) || req.user.name;

    if (!['cup', 'match', 'hole', 'pars', 'custom'].includes(kind) || !Number.isFinite(amount) || amount <= 0) {
      return res.redirect('/bets');
    }

    const row = { kind, stake_amount: amount, stake_unit: (stakeUnit || '£').trim().slice(0, 8) || '£', proposer_name: name };

    if (kind === 'cup') {
      const bundles = await buildAllMatchBundles();
      const { rows: sd } = await pool.query('SELECT * FROM sudden_death ORDER BY id DESC LIMIT 1');
      if (cupStatus(bundles, sd[0] || null).cupDecided) return res.redirect('/bets'); // Cup's already won
      row.ref_side = req.body.side === 'B' ? 'B' : 'A';
      row.claim = describeClaim('cup', { side: row.ref_side });
    } else if (kind === 'match') {
      const match = findMatch(req.body.matchId);
      if (!match) return res.redirect('/bets');
      const bundles = await buildAllMatchBundles();
      const bundle = bundles.find((b) => b.match.id === match.id);
      if (bundle.state.isComplete) return res.redirect('/bets'); // no betting on a decided match
      row.ref_match_id = match.id;
      row.ref_side = ['A', 'B', 'half'].includes(req.body.side) ? req.body.side : 'A';
      row.claim = describeClaim('match', { bundle, side: row.ref_side });
    } else if (kind === 'hole') {
      const match = findMatch(req.body.matchId);
      if (!match) return res.redirect('/bets');
      const holeNumber = Number(req.body.holeNumber);
      if (!holeNumber || holeNumber < 1 || holeNumber > match.holeCount) return res.redirect('/bets');
      const bundles = await buildAllMatchBundles();
      const bundle = bundles.find((b) => b.match.id === match.id);
      // Block if that hole's already decided, or the match closed early so
      // this hole will never be played at all.
      if (bundle.state.resultForHole(holeNumber) !== undefined || bundle.state.isComplete) return res.redirect('/bets');
      row.ref_match_id = match.id;
      row.ref_hole_number = holeNumber;
      row.ref_side = ['A', 'B', 'half'].includes(req.body.side) ? req.body.side : 'A';
      row.claim = describeClaim('hole', { bundle, side: row.ref_side, holeNumber });
    } else if (kind === 'pars') {
      const match = findMatch(req.body.matchId);
      const player = findPlayer(req.body.playerId);
      const line = Number(req.body.line);
      if (!match || !player || ![...match.sideA, ...match.sideB].includes(player.id) || !Number.isFinite(line)) return res.redirect('/bets');
      row.ref_match_id = match.id;
      row.ref_player_id = player.id;
      row.ref_line = line;
      row.ref_over_under = req.body.overUnder === 'under' ? 'under' : 'over';
      row.ref_score_type = req.body.scoreType === 'net' ? 'net' : 'gross';
      row.claim = describeClaim('pars', { matchId: match.id, playerId: player.id, line, overUnder: row.ref_over_under, scoreType: row.ref_score_type });
    } else {
      const claim = (req.body.claim || '').trim().slice(0, 200);
      if (!claim) return res.redirect('/bets');
      row.claim = claim;
    }

    await pool.query(
      `INSERT INTO wagers (kind, claim, ref_match_id, ref_hole_number, ref_side, ref_player_id, ref_line, ref_over_under, ref_score_type, stake_amount, stake_unit, proposer_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [row.kind, row.claim, row.ref_match_id || null, row.ref_hole_number || null, row.ref_side || null, row.ref_player_id || null, row.ref_line || null, row.ref_over_under || null, row.ref_score_type || null, row.stake_amount, row.stake_unit, row.proposer_name]
    );
    res.redirect('/bets');
  } catch (err) {
    next(err);
  }
});

router.post('/bets/:id/match', requireBettor, async (req, res, next) => {
  try {
    const matcherName = (req.body.matcherName || '').trim().slice(0, 40) || req.user.name;
    const { rows } = await pool.query('SELECT * FROM wagers WHERE id = $1', [req.params.id]);
    const w = rows[0];
    if (!w || w.status !== 'open') return res.redirect('/bets');
    await pool.query(`UPDATE wagers SET status = 'matched', matcher_name = $1, matched_at = now() WHERE id = $2`, [matcherName, w.id]);
    res.redirect('/bets');
  } catch (err) {
    next(err);
  }
});

router.post('/bets/:id/cancel', requireBettor, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM wagers WHERE id = $1', [req.params.id]);
    const w = rows[0];
    if (!w) return res.redirect('/bets');
    if (w.status === 'open' || req.user.isCaptain) {
      await pool.query(`UPDATE wagers SET status = 'void' WHERE id = $1`, [w.id]);
    }
    res.redirect('/bets');
  } catch (err) {
    next(err);
  }
});

router.post('/bets/:id/settle', requireCaptain, async (req, res, next) => {
  try {
    const winner = req.body.winner === 'matcher' ? 'matcher_won' : 'proposer_won';
    const { rows } = await pool.query('SELECT * FROM wagers WHERE id = $1', [req.params.id]);
    const w = rows[0];
    if (!w || w.status !== 'matched') return res.redirect('/bets');
    await pool.query(
      `UPDATE wagers SET status = 'settled', result = $1, settle_note = $2, settled_at = now() WHERE id = $3`,
      [winner, `Settled by ${req.user.name}`, w.id]
    );
    res.redirect('/bets');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
