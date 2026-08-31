(function () {
  'use strict';

  const raw = JSON.parse(document.getElementById('match-data').textContent);
  const app = document.getElementById('scoring-app');
  const matchId = app.getAttribute('data-match-id');
  let currentHole = Number(app.getAttribute('data-start-hole')) || 1;

  const LS_SCORES = `aldenham_scores_${matchId}`;
  const LS_META = `aldenham_meta_${matchId}`;
  const LS_STATS = `aldenham_stats_${matchId}`;
  const LS_CONFLICTS = `aldenham_conflicts_${matchId}`;
  const LS_PENDING = `aldenham_pending_${matchId}`;
  const LS_RESET_AT = `aldenham_resetAt_${matchId}`;

  function loadJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full/unavailable — best effort */ }
  }

  // scores: { [holeNumber]: { [playerId]: gross|null } } — server snapshot as the base.
  let scores = loadJSON(LS_SCORES, null) || JSON.parse(JSON.stringify(raw.scores || {}));
  let meta = loadJSON(LS_META, null) || JSON.parse(JSON.stringify(raw.entryMeta || {}));
  // stats: { [holeNumber]: { [playerId]: { putts, fairwayHit, gir } } } — optional, independent of gross.
  let stats = loadJSON(LS_STATS, null) || JSON.parse(JSON.stringify(raw.stats || {}));
  // conflicts: { [holeNumber]: { [playerId]: { gross, enteredBy, conflictGross, conflictEnteredBy } } }
  let conflicts = loadJSON(LS_CONFLICTS, null) || JSON.parse(JSON.stringify(raw.conflicts || {}));
  let pending = loadJSON(LS_PENDING, []); // [{holeNumber, playerId, gross, pickedUp, putts, fairwayHit, gir, ts}]

  function persist() {
    saveJSON(LS_SCORES, scores);
    saveJSON(LS_META, meta);
    saveJSON(LS_STATS, stats);
    saveJSON(LS_CONFLICTS, conflicts);
    saveJSON(LS_PENDING, pending);
  }

  // A captain reset clears the server's copy of this match outright -- but
  // a phone that already has this page open (or cached it earlier) has no
  // way to tell "deleted on purpose" apart from "nobody's scored it yet"
  // from the score data alone, since both just look like an empty match.
  // match_resets.reset_at is the explicit signal: if the server's is newer
  // than the last one we saw, wipe every bit of local state for this match
  // before doing anything else.
  function applyResetIfNeeded(serverResetAt) {
    if (!serverResetAt) return;
    const localResetAt = loadJSON(LS_RESET_AT, null);
    if (localResetAt && new Date(localResetAt).getTime() >= new Date(serverResetAt).getTime()) return;
    scores = {};
    meta = {};
    stats = {};
    conflicts = {};
    pending = [];
    saveJSON(LS_RESET_AT, serverResetAt);
    persist();
  }
  applyResetIfNeeded(raw.resetAt);

  const players = raw.sideA.concat(raw.sideB);
  const allPlayerIds = players.map((p) => p.id);
  const match = { format: raw.format, holeCount: raw.holeCount, sideA: raw.sideA.map((p) => p.id), sideB: raw.sideB.map((p) => p.id), points: raw.points };

  function currentStat(holeNumber, playerId) {
    return (stats[holeNumber] && stats[holeNumber][playerId]) || {};
  }

  function currentConflict(holeNumber, playerId) {
    return (conflicts[holeNumber] && conflicts[holeNumber][playerId]) || null;
  }

  // A raw player id shows as their name; a captain-override's "Name
  // (override)" string (from the server) already reads fine as-is.
  function nameForEnteredBy(v) {
    if (!v) return '';
    const p = players.find((x) => x.id === v);
    return p ? p.name : v;
  }

  // Every sync always carries the full known row for that hole/player (gross
  // + pickedUp + whatever stats are known) -- whichever field actually
  // changed, the others ride along unchanged so nothing gets clobbered
  // server-side (see routes/matches.js).
  function queueSync(holeNumber, playerId) {
    const gross = scores[holeNumber] ? scores[holeNumber][playerId] : undefined;
    const pickedUp = gross === null;
    const s = currentStat(holeNumber, playerId);

    meta[holeNumber] = meta[holeNumber] || {};
    meta[holeNumber][playerId] = { enteredBy: raw.currentUser.name, updatedAt: new Date().toISOString(), pending: true };

    const key = `${holeNumber}:${playerId}`;
    pending = pending.filter((e) => `${e.holeNumber}:${e.playerId}` !== key);
    pending.push({
      holeNumber, playerId,
      gross: pickedUp ? null : (gross === undefined ? null : gross),
      pickedUp: !!pickedUp,
      putts: typeof s.putts === 'number' ? s.putts : null,
      fairwayHit: typeof s.fairwayHit === 'boolean' ? s.fairwayHit : null,
      gir: typeof s.gir === 'boolean' ? s.gir : null,
      ts: Date.now()
    });

    persist();
    render();
    flushQueue();
  }

  function setEntry(holeNumber, playerId, gross, pickedUp) {
    scores[holeNumber] = scores[holeNumber] || {};
    if (pickedUp) {
      scores[holeNumber][playerId] = null;
    } else if (gross === null || gross === undefined) {
      delete scores[holeNumber][playerId];
    } else {
      scores[holeNumber][playerId] = gross;
    }
    // No score for the hole means no stats for it either.
    if (pickedUp || gross === null || gross === undefined) {
      if (stats[holeNumber]) delete stats[holeNumber][playerId];
    }
    queueSync(holeNumber, playerId);
  }

  function setStat(holeNumber, playerId, patch) {
    stats[holeNumber] = stats[holeNumber] || {};
    stats[holeNumber][playerId] = Object.assign({}, currentStat(holeNumber, playerId), patch);
    queueSync(holeNumber, playerId);
  }

  // ---- Sync ----

  let flushing = false;
  async function flushQueue() {
    if (flushing || !navigator.onLine || !pending.length) return renderSyncStatus();
    flushing = true;
    const batch = pending.slice();
    for (const entry of batch) {
      try {
        const res = await fetch(`/api/matches/${matchId}/scores`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry)
        });
        if (!res.ok) throw new Error('sync failed');
        const body = await res.json().catch(() => ({}));
        const key = `${entry.holeNumber}:${entry.playerId}`;
        pending = pending.filter((e) => `${e.holeNumber}:${e.playerId}` !== key || e.ts !== entry.ts);
        if (meta[entry.holeNumber] && meta[entry.holeNumber][entry.playerId]) {
          meta[entry.holeNumber][entry.playerId].pending = false;
        }
        if (body.conflict) {
          // Someone else already had a different number in for this hole --
          // the server kept theirs standing rather than take ours. Flag it
          // and fall back to showing what's actually authoritative instead
          // of our own optimistic (and now overruled) guess.
          conflicts[entry.holeNumber] = conflicts[entry.holeNumber] || {};
          conflicts[entry.holeNumber][entry.playerId] = {
            gross: body.existingGross,
            enteredBy: body.existingEnteredBy,
            conflictGross: entry.gross,
            conflictEnteredBy: raw.currentUser.id
          };
          scores[entry.holeNumber] = scores[entry.holeNumber] || {};
          scores[entry.holeNumber][entry.playerId] = body.existingGross;
        } else if (conflicts[entry.holeNumber]) {
          // A clean, agreeing write resolves any conflict that was there.
          delete conflicts[entry.holeNumber][entry.playerId];
        }
      } catch (e) {
        // stays queued — network's still down or flaky, we'll retry.
      }
    }
    persist();
    flushing = false;
    renderSyncStatus();
    renderHole();
  }

  async function pullRefresh() {
    if (!navigator.onLine) return;
    try {
      const res = await fetch(`/api/matches/${matchId}/scores`);
      if (!res.ok) return;
      const data = await res.json();
      applyResetIfNeeded(data.resetAt);
      const pendingKeys = new Set(pending.map((e) => `${e.holeNumber}:${e.playerId}`));
      for (const h of Object.keys(data.scores || {})) {
        for (const pid of Object.keys(data.scores[h])) {
          if (pendingKeys.has(`${h}:${pid}`)) continue; // don't clobber an unsynced local edit
          scores[h] = scores[h] || {};
          scores[h][pid] = data.scores[h][pid];
          if (data.entryMeta[h] && data.entryMeta[h][pid]) {
            meta[h] = meta[h] || {};
            meta[h][pid] = { ...data.entryMeta[h][pid], pending: false };
          }
          if (data.stats && data.stats[h] && data.stats[h][pid]) {
            stats[h] = stats[h] || {};
            stats[h][pid] = data.stats[h][pid];
          }
        }
      }
      // Conflicts (and their resolutions) always come straight from the
      // server -- a captain resolving one on their own device is exactly
      // the case this needs to pick up on the next poll.
      conflicts = JSON.parse(JSON.stringify(data.conflicts || {}));
      persist();
      renderHole();
    } catch (e) {
      // offline or server unreachable — just keep showing local state.
    }
  }

  // ---- Rendering ----

  function computeState() {
    return GolfLogic.computeMatchState(match, raw.courseHoles, raw.allocations, scores);
  }

  function firstNames(list) { return list.map((p) => p.name.split(' ')[0]).join('/'); }

  function stateText(state) {
    if (state.isComplete) {
      if (state.closedResult === 'A/S') return 'Halved, A/S';
      const leader = state.leadingSide === 'A' ? firstNames(raw.sideA) : firstNames(raw.sideB);
      return `${leader} win ${state.closedResult}`;
    }
    if (state.holesPlayed === 0) return 'Not started';
    if (state.leadingSide === null) return `All square thru ${state.holesPlayed}`;
    const leader = state.leadingSide === 'A' ? firstNames(raw.sideA) : firstNames(raw.sideB);
    return `${leader} ${state.diff} up thru ${state.holesPlayed}`;
  }

  function render() {
    renderHole();
    renderSyncStatus();
  }

  function renderHole() {
    const ch = raw.courseHoles.find((h) => h.number === currentHole);
    const state = computeState();

    document.getElementById('hole-header').innerHTML = `
      <div class="num">${currentHole}</div>
      <div class="hole-meta">Par ${ch.par} · ${ch.yards} yds · Stroke Index ${ch.strokeIndex}</div>
    `;

    const dotsEl = document.getElementById('hole-dots');
    dotsEl.innerHTML = '';
    for (let h = 1; h <= match.holeCount; h++) {
      const dot = document.createElement('span');
      const r = state.results.find((x) => x.holeNumber === h);
      let cls = 'hole-dot';
      if (r && r.winner === 'A') cls += ' played-a';
      else if (r && r.winner === 'B') cls += ' played-b';
      else if (r && r.winner === 'half') cls += ' played-half';
      if (h === currentHole) cls += ' current';
      dot.className = cls;
      dot.title = `Hole ${h}`;
      dot.addEventListener('click', () => goToHole(h));
      dotsEl.appendChild(dot);
    }

    const rowsEl = document.getElementById('player-rows');
    rowsEl.innerHTML = '';
    players.forEach((p) => {
      const side = raw.sideA.find((x) => x.id === p.id) ? 'a' : 'b';
      const gross = scores[currentHole] ? scores[currentHole][p.id] : undefined;
      const pickedUp = gross === null;
      const shots = (raw.allocations[p.id] && raw.allocations[p.id][currentHole]) || 0;
      const net = gross !== undefined && gross !== null ? gross - shots : null;
      const m = meta[currentHole] && meta[currentHole][p.id];
      const s = currentStat(currentHole, p.id);
      const c = currentConflict(currentHole, p.id);
      // Stats only make sense once there's an actual score for the hole.
      const showStats = !pickedUp && gross !== undefined;

      const row = document.createElement('div');
      row.className = `player-row side-${side}`;
      row.innerHTML = `
        <div class="player-row-head">
          <span class="player-name">${p.isCaptain ? '👑 ' : ''}${p.name}${shots ? `<span class="shot-badge">${shots > 1 ? '×' + shots + ' shots' : '1 shot'}</span>` : ''}</span>
          <button type="button" class="pickup-btn ${pickedUp ? 'active' : ''}" data-player="${p.id}">Picked up</button>
        </div>
        <div class="stepper" style="${pickedUp ? 'opacity:0.4;' : ''}">
          <button type="button" data-action="dec" data-player="${p.id}" ${pickedUp ? 'disabled' : ''}>−</button>
          <span class="gross-val">${gross === undefined || gross === null ? '–' : gross}</span>
          <button type="button" data-action="inc" data-player="${p.id}" ${pickedUp ? 'disabled' : ''}>+</button>
          <span class="net-note">${net !== null ? `net ${net}` : ''}</span>
        </div>
        ${showStats ? `
        <div class="stat-row">
          <div class="stat-block">
            <span class="stat-label">Putts</span>
            <div class="stepper small">
              <button type="button" data-stat-action="putts-dec" data-player="${p.id}">−</button>
              <span class="stat-val">${typeof s.putts === 'number' ? s.putts : '–'}</span>
              <button type="button" data-stat-action="putts-inc" data-player="${p.id}">+</button>
            </div>
          </div>
          ${ch.par !== 3 ? `
          <button type="button" class="stat-chip ${s.fairwayHit === true ? 'hit' : s.fairwayHit === false ? 'miss' : ''}" data-stat-toggle="fairwayHit" data-player="${p.id}">FW ${s.fairwayHit === true ? '✓' : s.fairwayHit === false ? '✗' : ''}</button>
          ` : ''}
          <button type="button" class="stat-chip ${s.gir === true ? 'hit' : s.gir === false ? 'miss' : ''}" data-stat-toggle="gir" data-player="${p.id}">GIR ${s.gir === true ? '✓' : s.gir === false ? '✗' : ''}</button>
        </div>
        ` : ''}
        ${c ? `
        <div class="conflict-banner">⚠ ${nameForEnteredBy(c.enteredBy)} said ${c.gross}, ${nameForEnteredBy(c.conflictEnteredBy)} said ${c.conflictGross} — showing ${c.gross} for now. Ask a captain to sort it out.</div>
        ` : ''}
        ${m ? `<div class="small muted mt" style="margin-top:6px;">${m.pending ? '⏳ ' : '✓ '}${m.enteredBy || ''}${m.updatedAt ? ' · ' + timeAgo(m.updatedAt) : ''}</div>` : ''}
      `;
      rowsEl.appendChild(row);
    });

    rowsEl.querySelectorAll('[data-stat-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-player');
        const cur = currentStat(currentHole, pid).putts;
        let next;
        if (typeof cur !== 'number') {
          next = 2; // sane starting point either way, like gross landing on par
        } else {
          next = btn.getAttribute('data-stat-action') === 'putts-inc' ? Math.min(12, cur + 1) : Math.max(1, cur - 1);
        }
        setStat(currentHole, pid, { putts: next });
      });
    });
    rowsEl.querySelectorAll('[data-stat-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-player');
        const field = btn.getAttribute('data-stat-toggle'); // 'fairwayHit' | 'gir'
        const cur = currentStat(currentHole, pid)[field];
        // Cycle: not recorded -> hit -> missed -> not recorded.
        const next = cur === undefined || cur === null ? true : cur === true ? false : null;
        setStat(currentHole, pid, { [field]: next });
      });
    });

    rowsEl.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-player');
        const current = scores[currentHole] ? scores[currentHole][pid] : undefined;
        let next;
        if (current === undefined || current === null) {
          // First tap just lands on par — a sane starting point either way.
          next = ch.par;
        } else {
          next = btn.getAttribute('data-action') === 'inc' ? current + 1 : Math.max(1, current - 1);
        }
        setEntry(currentHole, pid, next, false);
      });
    });
    rowsEl.querySelectorAll('.pickup-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-player');
        const current = scores[currentHole] ? scores[currentHole][pid] : undefined;
        if (current === null) setEntry(currentHole, pid, null, false); // toggle off -> back to not entered
        else setEntry(currentHole, pid, null, true);
      });
    });

    const winner = state.resultForHole(currentHole);
    const banner = document.getElementById('hole-result-banner');
    let bannerText;
    if (winner === 'A') bannerText = `${firstNames(raw.sideA)} win the hole`;
    else if (winner === 'B') bannerText = `${firstNames(raw.sideB)} win the hole`;
    else if (winner === 'half') bannerText = 'Hole halved';
    else bannerText = 'Waiting on scores…';
    banner.textContent = `${bannerText} — ${stateText(state)}`;

    document.getElementById('prev-hole').disabled = currentHole <= 1;
    const closedBeforeHere = state.isComplete && currentHole > state.holesPlayed;
    document.getElementById('next-hole').disabled = currentHole >= match.holeCount || closedBeforeHere;
    if (closedBeforeHere) banner.textContent = `Match closed ${state.closedResult} — holes beyond ${state.holesPlayed} don't count.`;
  }

  function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  }

  function renderSyncStatus() {
    const el = document.getElementById('sync-status');
    const offline = !navigator.onLine;
    const dotClass = offline ? 'offline' : pending.length ? 'pending' : '';
    const text = offline
      ? `Offline — ${pending.length} unsynced, will send when back online`
      : pending.length
        ? `Syncing ${pending.length}…`
        : 'All scores synced';
    el.innerHTML = `<span class="sync-dot ${dotClass}"></span>${text}`;
  }

  function goToHole(h) {
    currentHole = Math.min(Math.max(h, 1), match.holeCount);
    const url = new URL(window.location.href);
    url.searchParams.set('hole', currentHole);
    history.replaceState(null, '', url);
    render();
  }

  document.getElementById('prev-hole').addEventListener('click', () => goToHole(currentHole - 1));
  document.getElementById('next-hole').addEventListener('click', () => goToHole(currentHole + 1));

  window.addEventListener('online', () => { renderSyncStatus(); flushQueue(); pullRefresh(); });
  window.addEventListener('offline', renderSyncStatus);
  setInterval(flushQueue, 8000);
  setInterval(pullRefresh, 15000);

  render();
  flushQueue();
})();
