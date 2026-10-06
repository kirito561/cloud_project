(() => {
  'use strict';

  let currentSession = null;
  let gameLoopId = null;
  let refreshInterval = null;
  let keyHandlers = null;
  let resizeHandler = null;
  let PROFILES = {};
  let SESSIONS = [];
  let currentProfileKey = null;
  let isFullscreen = false;

  // ── Game Icons (low-fi stroke glyphs) ────────
  const GAME_ICONS = {
    'valorant-lab': '<svg class="game-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" shape-rendering="crispEdges" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    'racing-lab': '<svg class="game-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" shape-rendering="crispEdges" aria-hidden="true"><path d="M3.34 19a10 10 0 1 1 17.32 0"/><path d="M12 14l4-4"/><path d="M12 5V2M5 12H2M19 12h3"/></svg>',
    'open-2048': '<svg class="game-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" shape-rendering="crispEdges" aria-hidden="true"><rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/></svg>',
    'open-dino': '<svg class="game-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" shape-rendering="crispEdges" aria-hidden="true"><path d="M13 2v6M13 8h5v3a1 1 0 0 1-1 1h-4z"/><path d="M16 12v4M14 16v5M13 8V6M16 12h1.5"/></svg>',
    'open-hextris': '<svg class="game-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" shape-rendering="crispEdges" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M12 3v5M12 16v5M3.5 8.5l4.3 2.5M16.2 13l4.3 2.5"/></svg>',
    'astro-sweep': '<svg class="game-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" shape-rendering="crispEdges" aria-hidden="true"><path d="M12 2l2.5 10L12 22l-2.5-10z"/><path d="M12 6l1.5 6L12 18l-1.5-6z"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="17" r="2.5"/></svg>',
    'fx-burst': '<svg class="game-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" shape-rendering="crispEdges" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19"/></svg>'
  };

  function gameIcon(key) {
    return GAME_ICONS[key] || '<svg class="game-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" shape-rendering="crispEdges" aria-hidden="true"><path d="M5 12h14M12 5v14M5 12l7-7M19 12l-7 7"/></svg>';
  }

  // ── Toast System ─────────────────────────────
  function toast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const tags = { success: '[OK]', error: '[ERR]', info: '[HINT]' };
    el.innerHTML = `
      <span class="toast-tag">${tags[type] || tags.info}</span>
      <span class="toast-msg">${escapeHtml(message)}</span>
      <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    container.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'toast-out 0.3s steps(4, end) forwards';
      el.addEventListener('animationend', () => el.remove());
    }, duration);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Auth ─────────────────────────────────────
  window.googleSignIn = function () {
    window.location.href = '/api/auth/google';
  };

  window.demoLogin = async function () {
    const btn = document.getElementById('google-btn');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'student@cloudplay.local', password: 'cloudplay123' })
      });
      if (res.ok) {
        enterDashboard('student@cloudplay.local');
        toast('DEMO MODE :: signed in as student@cloudplay.local', 'success', 5000);
      } else {
        const err = await res.json();
        toast(err.error || 'demo sign in failed', 'error');
      }
    } catch {
      toast('Connection failed. Is the server running?', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  function enterDashboard(email) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    const who = document.getElementById('whoami-user');
    if (who) who.textContent = email;
    refreshDashboard();
    refreshInterval = setInterval(refreshDashboard, 3000);
  }

  async function bootstrapAuth() {
    try {
      const r = await fetch('/api/session');
      const d = await r.json();
      if (d && d.user) {
        enterDashboard(d.user.email);
        return;
      }
    } catch { /* fall through to config check */ }
    try {
      const c = await fetch('/api/auth/config');
      const cfg = await c.json();
      const demoRow = document.getElementById('demo-row');
      const hint = document.getElementById('auth-hint');
      if (demoRow && cfg.googleConfigured === false) {
        demoRow.classList.remove('hidden');
        if (hint) hint.textContent = '$ hint :: google oauth unconfigured here — demo mode active';
      }
    } catch { /* ignore */ }
  }

  window.logout = function () {
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    closeStream();
    fetch('/api/logout', { method: 'POST' })
      .catch(() => {})
      .finally(() => window.location.reload());
  };

  // ── Dashboard ────────────────────────────────
  async function refreshDashboard() {
    try {
      const res = await fetch('/api/state');
      const data = await res.json();
      if (!PROFILES || !Object.keys(PROFILES).length) {
        PROFILES = data.profiles || {};
        renderLauncher(PROFILES);
      }
      const countEl = document.getElementById('launcher-count');
      if (countEl) countEl.textContent = `${String(Object.keys(PROFILES).length).padStart(2, '0')} PROGRAMS`;
      const sessEl = document.getElementById('session-count');
      if (sessEl) sessEl.textContent = `${data.sessions.length} RUNNING`;
      renderNodes(data.nodes);
      renderSessions(data.sessions);
      SESSIONS = data.sessions || [];
      renderStreamCollage();
    } catch {
      toast('Failed to fetch dashboard state', 'error');
    }
  }

  function resourceLevel(used, total) {
    if (total === 0) return 'low';
    const pct = used / total;
    if (pct >= 0.8) return 'high';
    if (pct >= 0.5) return 'mid';
    return 'low';
  }

  function renderNodes(nodes) {
    const container = document.getElementById('nodes-container');
    const gpuUsed = nodes.reduce((a, n) => a + n.used.gpu, 0);
    const gpuCap = nodes.reduce((a, n) => a + n.capacity.gpu, 0);
    const meta = document.getElementById('node-meta');
    if (meta) meta.textContent = `FLOTILLA :: GPU ${gpuUsed}/${gpuCap}`;
    container.innerHTML = nodes.map(node => {
      const ok = !node.status || node.status === 'ready';
      const label = ok ? 'OK' : 'ERR';
      return `
        <div class="node-card">
          <div class="node-header">
            <div>
              <div class="node-id">${escapeHtml(node.id)}</div>
              <div class="node-region">@ ${escapeHtml(node.region || '')}</div>
            </div>
            <span class="status-tag ${ok ? 'ok' : 'err'}">${label}</span>
          </div>
          ${renderMeterRow('CPU', node.used.cpu, node.capacity.cpu)}
          ${renderMeterRow('RAM', node.used.ram, node.capacity.ram)}
          ${renderMeterRow('GPU', node.used.gpu, node.capacity.gpu)}
        </div>
      `;
    }).join('');
  }

  function asciiMeter(used, total, width = 16) {
    const pct = total ? Math.max(0, Math.min(1, used / total)) : 0;
    const filled = Math.round(pct * width);
    return `[${'|'.repeat(filled)}${'.'.repeat(width - filled)}]`;
  }

  function renderMeterRow(label, used, total) {
    const level = resourceLevel(used, total);
    return `
      <div class="meter">
        <span class="meter-tag">${label}</span>
        <span class="meter-bar ${level}">${asciiMeter(used, total)}</span>
        <span class="meter-val">${used} / ${total}</span>
      </div>
    `;
  }

  function sessionGpuLoad(s) {
    const gpu = (s.resources && s.resources.gpu) || 0;
    if (s.status !== 'running' || gpu === 0) return null;
    const profile = PROFILES[s.profileKey];
    const heavy = !!(profile && (profile.gpuHeavy || profile.gpu >= 2));
    const seed = (s.id && s.id.split('')[2] ? s.id.split('')[2].charCodeAt(0) : 7) + s.id.length * 13 + gpu * 4;
    const wave = (Math.sin(Date.now() / 900 + seed) + 1) * 0.5;
    const base = heavy ? 62 : gpu >= 2 ? 42 : 26;
    return Math.round(Math.min(98, base + wave * 30));
  }

  function gpuLevelClass(load) {
    return load >= 70 ? 'high' : load >= 40 ? 'mid' : 'low';
  }

  function gpuBar(load, width = 8) {
    const filled = Math.round((Math.min(100, load) / 100) * width);
    return `[${'|'.repeat(filled)}${'.'.repeat(width - filled)}]`;
  }

  function renderSessions(sessions) {
    const container = document.getElementById('sessions-container');
    if (!sessions.length) {
      container.innerHTML = '<div class="empty-state">no active sessions :: launch a workload above</div>';
      return;
    }
    container.innerHTML = sessions.map(s => {
      const uptime = s.createdAt ? formatUptime(Date.now() - s.createdAt) : '--';
      const r = s.resources;
      const statusTxt = s.status === 'running' ? 'RUN' : 'BOOT';
      const profile = PROFILES[s.profileKey];
      const gpuLoad = sessionGpuLoad(s);
      const coverHtml = profile && profile.cover
        ? `<img class="session-cover" src="${escapeHtml(profile.cover)}" alt="" onerror="this.style.display='none'">`
        : '<span class="cover-fallback"></span>';
      return `
        <div class="session-card ${s.status}">
          <span class="cover-wrap cover-wrap-sm">
            ${coverHtml}
            <span class="game-icon-wrap" aria-hidden="true">${gameIcon(s.profileKey)}</span>
          </span>
          <div class="session-info">
            <div class="session-name">${escapeHtml(s.name)}</div>
            <div class="session-meta">${escapeHtml(s.id)} @ ${escapeHtml(s.nodeId)} &middot; ${uptime}</div>
            <div class="session-meta">${r.cpu} vCPU &middot; ${r.ram} GB &middot; ${r.gpu} GPU</div>
            ${s.status === 'running' && gpuLoad !== null ? `
              <div class="session-gpu">
                <span class="sg-tag">GPU</span>
                <span class="sg-bar ${gpuLevelClass(gpuLoad)}">${gpuBar(gpuLoad)}</span>
                <span class="sg-val">${gpuLoad}%</span>
                <span class="sg-note">${gpuLoad >= 70 ? 'PEAK' : gpuLoad >= 40 ? 'LOAD' : 'IDLE'}</span>
              </div>` : ''}
            ${s.status === 'running' ? `
              <div class="resource-stepper">
                <div class="stepper-item">
                  <span class="stepper-label">CPU</span>
                  <button class="stepper-btn" ${r.cpu === 0 ? 'disabled' : ''} onclick="window._adjustResource('${s.id}','cpu',-1,${r.cpu},${r.ram},${r.gpu})">&minus;</button>
                  <span class="stepper-value">${r.cpu}</span>
                  <button class="stepper-btn" onclick="window._adjustResource('${s.id}','cpu',1,${r.cpu},${r.ram},${r.gpu})">+</button>
                </div>
                <div class="stepper-item">
                  <span class="stepper-label">RAM</span>
                  <button class="stepper-btn" ${r.ram === 0 ? 'disabled' : ''} onclick="window._adjustResource('${s.id}','ram',-2,${r.cpu},${r.ram},${r.gpu})">&minus;</button>
                  <span class="stepper-value">${r.ram} GB</span>
                  <button class="stepper-btn" onclick="window._adjustResource('${s.id}','ram',2,${r.cpu},${r.ram},${r.gpu})">+</button>
                </div>
                <div class="stepper-item">
                  <span class="stepper-label">GPU</span>
                  <button class="stepper-btn" ${r.gpu === 0 ? 'disabled' : ''} onclick="window._adjustResource('${s.id}','gpu',-1,${r.cpu},${r.ram},${r.gpu})">&minus;</button>
                  <span class="stepper-value">${r.gpu}</span>
                  <button class="stepper-btn" onclick="window._adjustResource('${s.id}','gpu',1,${r.cpu},${r.ram},${r.gpu})">+</button>
                </div>
                <span class="stepper-hint">reclaim a resource down to 0 to auto-terminate</span>
              </div>` : ''}
          </div>
          <div class="session-right">
            <span class="session-status ${s.status}">${statusTxt}</span>
            <div class="session-actions">
              ${s.status === 'running'
                ? `<button class="btn-accent" onclick="window._launchStream('${s.profileKey}', '${escapeHtml(s.name)}')">ATTACH</button>`
                : ''}
              <button class="btn-danger" onclick="window._terminate('${s.id}')">KILL</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── Resource Reclaim / Resize ───────────────
  window._adjustResource = async function (sessionId, key, delta, curCpu, curRam, curGpu) {
    const current = { cpu: curCpu, ram: curRam, gpu: curGpu };
    const next = { cpu: curCpu, ram: curRam, gpu: curGpu };
    next[key] = Math.max(0, next[key] + delta);

    if (next[key] !== current[key] && next[key] === 0) {
      toast(`${key.toUpperCase()} reclaimed to 0 — terminating session`, 'info');
      await window._terminate(sessionId, `${key.toUpperCase()} reclaimed — session auto-terminated`);
      return;
    }
    if (next[key] === current[key]) return;

    try {
      const res = await fetch('/api/sessions/resize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, nextResources: next })
      });
      const data = await res.json();
      if (res.ok) {
        toast(`Session resized: ${next.cpu} vCPU / ${next.ram} GB / ${next.gpu} GPU`, 'success');
      } else {
        toast(data.error || 'Resize failed', 'error');
      }
      refreshDashboard();
    } catch {
      toast('Network error during resize', 'error');
    }
  };

  function formatUptime(ms) {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ${sec % 60}s`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  }

  // ── Game Launcher (rendered from server profiles) ──
  function renderLauncher(profiles) {
    const container = document.getElementById('launcher-container');
    const entries = Object.entries(profiles);
    const original = entries.filter(([, p]) => p.category !== 'web');
    const web = entries.filter(([, p]) => p.category === 'web');

    const block = (group, title) => group.length
      ? `
        <div class="launcher-group">
          <div class="launcher-group-title">${title}</div>
          <div class="launch-buttons">
          ${group.map(([key, p]) => `
            <div class="launch-btn" onclick="window._startSession('${key}')" role="button" tabindex="0">
              <span class="cover-wrap">
                ${p.cover
                  ? `<img class="game-cover" src="${escapeHtml(p.cover)}" alt="" loading="lazy" onerror="this.style.display='none'">`
                  : '<span class="cover-fallback cover-fallback-lg"></span>'}
                <span class="game-icon-wrap" aria-hidden="true">${gameIcon(key)}</span>
              </span>
              <div class="launch-main">
                <div class="game-name">${escapeHtml(p.name)}</div>
                ${p.description ? `<div class="game-desc">${escapeHtml(p.description)}</div>` : ''}
                <div class="game-meta">
                  ${specsText(p)}
                  ${p.gpuHeavy ? `<span class="meta-chip gpu-chip">GPU-HEAVY</span>` : ''}
                  ${p.license ? `<span class="meta-chip">${escapeHtml(p.license)}</span>` : ''}
                  ${p.author ? `<span class="meta-chip">@${escapeHtml(p.author)}</span>` : ''}
                </div>
              </div>
              <span class="launch-cmd">LAUNCH</span>
            </div>
          `).join('')}
          </div>
        </div>`
      : '';

    container.innerHTML = block(original, 'Built-in Simulations') + block(web, 'Open-Source Web Games');
  }

  function specsText(p) {
    const parts = [`${p.cpu} vCPU`, `${p.ram} GB RAM`];
    if (p.gpu > 0) parts.push(`${p.gpu} GPU`);
    return parts.map(x => `<span class="meta-chip">${x}</span>`).join('');
  }

  // ── Session Management ───────────────────────
  window._startSession = async function (profileKey) {
    try {
      const res = await fetch('/api/sessions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileKey })
      });
      const data = await res.json();
      if (res.ok) {
        toast(`${data.name} session provisioning...`, 'success');
        refreshDashboard();
      } else {
        toast(data.error || 'Failed to create session', 'error');
      }
    } catch {
      toast('Network error creating session', 'error');
    }
  };

  window._terminate = async function (sessionId, msg) {
    try {
      await fetch('/api/sessions/terminate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      if (currentSession === sessionId) closeStream();
      toast(msg || 'Session terminated', 'info');
      refreshDashboard();
    } catch {
      toast('Failed to terminate session', 'error');
    }
  };

  // ── Stream ──────────────────────────────────
  let latencyTimer = null;

  window._launchStream = function (profileKey, name) {
    currentProfileKey = profileKey;
    const profile = PROFILES[profileKey];

    const container = document.getElementById('stream-container');
    container.classList.remove('hidden');
    document.getElementById('active-game-title').textContent = `REMOTE STREAM :: ${name.toUpperCase()}`;
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (profile && profile.category === 'web' && profile.source) {
      launchExternalStream(profile.source, name);
    } else {
      launchCanvasStream(profileKey, name);
    }

    currentSession = name;
    startLatencySim();
    startTelemetry(profile);
    renderStreamCollage();
  };

  function startLatencySim() {
    stopLatencySim();
    const latEl = document.getElementById('stat-latency');
    if (!latEl) return;
    latencyTimer = setInterval(() => {
      latEl.textContent = `~${8 + Math.floor(Math.random() * 8)}ms`;
    }, 2000);
  }

  function stopLatencySim() {
    if (latencyTimer) { clearInterval(latencyTimer); latencyTimer = null; }
    const latEl = document.getElementById('stat-latency');
    if (latEl) latEl.textContent = '~--ms';
  }

  // ── GPU / FPS telemetry overlay ──────────────
  let telemetryTimer = null;
  let measuredFps = 0;

  function startTelemetry(profile) {
    stopTelemetry();
    const gpuEl = document.getElementById('stat-gpu');
    const fpsEl = document.getElementById('stat-fps');
    const liveEl = document.getElementById('stat-live');
    if (liveEl) liveEl.classList.add('on');
    if (!gpuEl || !fpsEl) return;
    const gpuCount = (profile && profile.gpu) || 0;
    const heavy = !!(profile && (profile.gpuHeavy || profile.gpu >= 2));
    telemetryTimer = setInterval(() => {
      const wave = (Math.sin(Date.now() / 900) + 1) * 0.5;
      const gpuPct = gpuCount === 0 ? 2 + Math.floor(wave * 6) : heavy ? Math.round(58 + wave * 40) : Math.round(22 + wave * 32);
      gpuEl.textContent = `GPU ${gpuPct}%`;
      const simFps = 54 + Math.floor(Math.random() * 7) - (gpuPct > 90 ? 8 : 0);
      fpsEl.textContent = `${Math.max(24, Math.min(60, Math.round(measuredFps || simFps)))} FPS`;
    }, 1100);
  }

  function stopTelemetry() {
    if (telemetryTimer) { clearInterval(telemetryTimer); telemetryTimer = null; }
    measuredFps = 0;
    const gpuEl = document.getElementById('stat-gpu');
    const fpsEl = document.getElementById('stat-fps');
    const liveEl = document.getElementById('stat-live');
    if (gpuEl) gpuEl.textContent = 'GPU --%';
    if (fpsEl) fpsEl.textContent = '-- FPS';
    if (liveEl) liveEl.classList.remove('on');
  }

  // ── Fullscreen game screen ───────────────────
  window.toggleFullscreen = function () {
    const pane = document.getElementById('stream-container');
    if (!pane) return;
    if (isFullscreen) {
      pane.classList.remove('fullscreen');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      isFullscreen = false;
      updateFullscreenBtn();
    } else {
      pane.classList.add('fullscreen');
      if (pane.requestFullscreen) pane.requestFullscreen().catch(() => {});
      isFullscreen = true;
      updateFullscreenBtn();
    }
    if (resizeHandler) resizeHandler();
    window.dispatchEvent(new Event('resize'));
  };

  function updateFullscreenBtn() {
    const b = document.getElementById('fullscreen-btn');
    if (b) b.textContent = isFullscreen ? 'EXIT FULLSCREEN [ - ]' : 'FULLSCREEN [ + ]';
  }

  function exitFullscreenState() {
    const pane = document.getElementById('stream-container');
    if (pane) pane.classList.remove('fullscreen');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    isFullscreen = false;
    updateFullscreenBtn();
  }

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && isFullscreen) {
      const pane = document.getElementById('stream-container');
      if (pane) pane.classList.remove('fullscreen');
      isFullscreen = false;
      updateFullscreenBtn();
      window.dispatchEvent(new Event('resize'));
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (isFullscreen) {
      exitFullscreenState();
      if (resizeHandler) resizeHandler();
      window.dispatchEvent(new Event('resize'));
      return;
    }
    if (currentSession) closeStream();
  });

  // ── In-stream cover collage / game switcher ──
  function renderStreamCollage() {
    const strip = document.getElementById('stream-collage');
    if (!strip) return;
    const running = new Set(
      (SESSIONS || []).filter(s => s.status === 'running').map(s => s.profileKey)
    );
    const active = currentProfileKey;
    strip.innerHTML = Object.entries(PROFILES || {}).map(([key, p]) => `
      <div class="sc-tile ${running.has(key) ? 'run' : ''} ${key === active ? 'active' : ''}"
           onclick="window._collageLaunch('${key}')" role="button" tabindex="0" title="${escapeHtml(p.name)}">
        <img class="sc-cover" src="${escapeHtml(p.cover || '')}" alt="" loading="lazy" onerror="this.style.display='none'">
        <span class="sc-tag ${running.has(key) ? 'run' : ''}">${running.has(key) ? 'RUN' : 'IDLE'}</span>
        <span class="sc-name">${escapeHtml(p.name)}</span>
      </div>
    `).join('');
  }
  window._renderStreamCollage = renderStreamCollage;

  window._collageLaunch = async function (profileKey) {
    const p = PROFILES[profileKey];
    if (!p) return;
    if (profileKey === currentProfileKey) return;
    const existing = (SESSIONS || []).find(s => s.profileKey === profileKey && s.status === 'running');
    if (existing) {
      _launchStream(profileKey, existing.name);
      return;
    }
    toast(`provisioning ${p.name} on the fleet...`, 'info');
    try {
      const res = await fetch('/api/sessions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileKey })
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Failed to create session', 'error'); return; }
      const id = data.id;
      const t0 = Date.now();
      const poll = setInterval(async () => {
        await refreshDashboard();
        const s = (SESSIONS || []).find(x => x.id === id);
        if (s && s.status === 'running') {
          clearInterval(poll);
          _launchStream(profileKey, s.name);
        } else if (Date.now() - t0 > 8000) {
          clearInterval(poll);
          toast('provision timed out — try again', 'error');
        }
      }, 900);
    } catch {
      toast('Network error provisioning session', 'error');
    }
  };

  // ── External (iframe) stream ────────────────
  function launchExternalStream(source, name) {
    closeCanvasStream();
    const canvas = document.getElementById('gameCanvas');
    const frameHost = document.getElementById('game-frame-host');
    const frame = document.getElementById('game-frame');

    canvas.classList.add('hidden');
    frameHost.classList.remove('hidden');

    frame.setAttribute('src', 'about:blank');
    frame.setAttribute('src', source);
  }

  // ── Canvas stream (built-in simulations) ────
  function launchCanvasStream(profileKey, name) {
    closeCanvasStream();

    const canvas = document.getElementById('gameCanvas');
    const frameHost = document.getElementById('game-frame-host');
    canvas.classList.remove('hidden');
    frameHost.classList.add('hidden');

    const container = document.getElementById('stream-container');
    const ctx = canvas.getContext('2d');

    function resizeCanvas() {
      const wrapper = canvas.parentElement;
      canvas.width = wrapper.clientWidth;
      canvas.height = wrapper.clientHeight;
    }
    resizeCanvas();
    resizeHandler = resizeCanvas;
    window.addEventListener('resize', resizeHandler);

    let state = {};
    const keys = {};
    state.keys = keys;

    keyHandlers = {
      down: e => { keys[e.key] = true; if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault(); },
      up: e => { keys[e.key] = false; }
    };
    window.addEventListener('keydown', keyHandlers.down);
    window.addEventListener('keyup', keyHandlers.up);

    canvas.onmousemove = e => {
      const rect = canvas.getBoundingClientRect();
      state.mouse = {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height)
      };
    };

    canvas.onclick = () => {
      if (profileKey === 'valorant-lab') handleClickTarget(state, canvas);
      else if (profileKey === 'fx-burst') state.poke = Date.now();
    };

    if (profileKey === 'valorant-lab') {
      state.targets = generateTargets(canvas, 5);
      state.mouse = { x: 0, y: 0 };
      state.score = 0;
      state.totalShots = 0;
      state.crosshairSize = 14;
    } else if (profileKey === 'racing-lab') {
      state.playerX = canvas.width * 0.5;
      state.playerW = 30;
      state.playerH = 50;
      state.lanes = [0.25, 0.5, 0.75];
      state.obstacles = [];
      state.speed = 3;
      state.distance = 0;
      state.score = 0;
      state.roadOffset = 0;
    } else if (profileKey === 'astro-sweep') {
      state.ship = { x: canvas.width / 2, y: canvas.height - 64 };
      state.bullets = [];
      state.rocks = [];
      state.score = 0;
      state.lives = 3;
      state.coolDown = 0;
      state.mouse = { x: 0, y: 0 };
    } else if (profileKey === 'fx-burst') {
      state.particles = [];
      for (let i = 0; i < 4200; i++) {
        state.particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 1.6,
          vy: (Math.random() - 0.5) * 1.6,
          r: 0.6 + Math.random() * 1.8,
          k: Math.random()
        });
      }
      state.mouse = { x: canvas.width / 2, y: canvas.height / 2 };
      state.poke = 0;
    }

    state.__fpsT = performance.now();
    state.__fpsF = 0;

    function render() {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      state.__fpsF++;
      const now = performance.now();
      if (now - state.__fpsT >= 500) {
        measuredFps = Math.round((state.__fpsF * 1000) / (now - state.__fpsT));
        state.__fpsT = now;
        state.__fpsF = 0;
      }

      if (profileKey === 'valorant-lab') renderValorantLab(ctx, state, w, h);
      else if (profileKey === 'racing-lab') renderRacingLab(ctx, state, w, h);
      else if (profileKey === 'astro-sweep') renderAstroSweep(ctx, state, w, h);
      else if (profileKey === 'fx-burst') renderFxBurst(ctx, state, w, h);

      gameLoopId = requestAnimationFrame(render);
    }
    render();
  };

  function closeCanvasStream() {
    if (gameLoopId) { cancelAnimationFrame(gameLoopId); gameLoopId = null; }
    if (keyHandlers) {
      window.removeEventListener('keydown', keyHandlers.down);
      window.removeEventListener('keyup', keyHandlers.up);
keyHandlers = null;
      }
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
      }
      const canvas = document.getElementById('gameCanvas');
      if (canvas) { canvas.onmousemove = null; canvas.onclick = null; }
    }

  function closeStream() {
    keepStreamHidden();
    closeCanvasStream();
    stopLatencySim();
    stopTelemetry();
    exitFullscreenState();

    const frame = document.getElementById('game-frame');
    if (frame) {
      frame.setAttribute('src', 'about:blank');
      frame.removeAttribute('src');
    }
    const frameHost = document.getElementById('game-frame-host');
    const canvas = document.getElementById('gameCanvas');
    if (frameHost) frameHost.classList.add('hidden');
    if (canvas) canvas.classList.add('hidden');

    currentSession = null;
    currentProfileKey = null;
  }
  window.closeStream = closeStream;

  function keepStreamHidden() {
    const container = document.getElementById('stream-container');
    container.classList.add('hidden');
  }

  // ── Valorant Lab Renderer ────────────────────
  function generateTargets(canvas, count) {
    return Array.from({ length: count }, () => ({
      x: 60 + Math.random() * (canvas.width - 120),
      y: 60 + Math.random() * (canvas.height - 120),
      alive: true,
      respawn: 0
    }));
  }

  function handleClickTarget(state, canvas) {
    if (!state.mouse) return;
    const r = state.crosshairSize + 8;
    state.totalShots++;
    state.targets.forEach(t => {
      if (!t.alive) return;
      const dx = state.mouse.x - (t.x + 12);
      const dy = state.mouse.y - (t.y + 12);
      if (Math.sqrt(dx * dx + dy * dy) < r) {
        t.alive = false;
        t.respawn = Date.now() + 1500;
        state.score++;
      }
    });
  }

  function renderValorantLab(ctx, s, w, h) {
    // Subtle grid
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    // Targets
    s.targets.forEach(t => {
      if (!t.alive) {
        if (Date.now() > t.respawn) {
          t.alive = true;
          t.x = 60 + Math.random() * (w - 120);
          t.y = 60 + Math.random() * (h - 120);
        }
        return;
      }
      const bob = Math.sin(Date.now() / 400 + t.x) * 3;
      ctx.fillStyle = '#ff4444';
      ctx.shadowColor = '#ff4444';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(t.x + 12, t.y + 12 + bob, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Inner circle
      ctx.fillStyle = '#ff6666';
      ctx.beginPath();
      ctx.arc(t.x + 12, t.y + 12 + bob, 6, 0, Math.PI * 2);
      ctx.fill();
    });

    // Crosshair
    if (s.mouse) {
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2;
      const mx = s.mouse.x, my = s.mouse.y;
      const cs = s.crosshairSize;
      // Outer ring
      ctx.beginPath();
      ctx.arc(mx, my, cs, 0, Math.PI * 2);
      ctx.stroke();
      // Crosshair lines
      ctx.beginPath();
      ctx.moveTo(mx - cs - 4, my); ctx.lineTo(mx - 4, my);
      ctx.moveTo(mx + 4, my); ctx.lineTo(mx + cs + 4, my);
      ctx.moveTo(mx, my - cs - 4); ctx.lineTo(mx, my - 4);
      ctx.moveTo(mx, my + 4); ctx.lineTo(mx, my + cs + 4);
      ctx.stroke();
      // Center dot
      ctx.fillStyle = '#00ff88';
      ctx.beginPath();
      ctx.arc(mx, my, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // HUD
    const accuracy = s.totalShots ? Math.round((s.score / s.totalShots) * 100) : 0;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(10, h - 36, 280, 26);
    ctx.fillStyle = '#00d4ff';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText(`Hits: ${s.score}  |  Shots: ${s.totalShots}  |  Accuracy: ${accuracy}%`, 18, h - 18);
  }

  // ── Racing Lab Renderer ──────────────────────
  function renderRacingLab(ctx, s, w, h) {
    // Road
    const roadLeft = w * 0.15, roadRight = w * 0.85, roadW = roadRight - roadLeft;
    ctx.fillStyle = '#111';
    ctx.fillRect(roadLeft, 0, roadW, h);

    // Road lines (scrolling)
    s.roadOffset = (s.roadOffset + s.speed) % 30;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 20]);
    ctx.lineDashOffset = -s.roadOffset;
    for (let lane = 1; lane < 3; lane++) {
      const lx = roadLeft + (roadW / 3) * lane;
      ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, h); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Road edges
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(roadLeft, 0); ctx.lineTo(roadLeft, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(roadRight, 0); ctx.lineTo(roadRight, h); ctx.stroke();

    // Controls
    const moveSpeed = 5;
    if (s.keys['ArrowLeft'] || s.keys['a']) s.playerX -= moveSpeed;
    if (s.keys['ArrowRight'] || s.keys['d']) s.playerX += moveSpeed;
    s.playerX = Math.max(roadLeft + 10, Math.min(roadRight - s.playerW - 10, s.playerX));

    // Obstacles
    s.speed = 3 + s.distance * 0.0005;
    if (Math.random() < 0.02 + s.distance * 0.00001) {
      const laneIdx = Math.floor(Math.random() * 3);
      const lx = roadLeft + (roadW / 3) * laneIdx + (roadW / 6) - 14;
      if (!s.obstacles.some(o => o.y < 40)) {
        s.obstacles.push({ x: lx, y: -30, w: 28, h: 28 });
      }
    }

    let crashed = false;
    s.obstacles = s.obstacles.filter(o => {
      o.y += s.speed;
      if (o.y > h + 40) { s.score++; s.distance += 10; return false; }

      // Collision
      if (s.playerX < o.x + o.w && s.playerX + s.playerW > o.x &&
          h - s.playerH - 10 < o.y + o.h && h - 10 > o.y) {
        crashed = true;
      }

      ctx.fillStyle = '#ff8800';
      ctx.shadowColor = '#ff8800';
      ctx.shadowBlur = 6;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.shadowBlur = 0;
      return true;
    });

    // Player car
    const py = h - s.playerH - 10;
    if (crashed) {
      ctx.fillStyle = '#ff4444';
      ctx.shadowColor = '#ff4444';
      ctx.shadowBlur = 16;
    } else {
      ctx.fillStyle = '#a855f7';
      ctx.shadowColor = '#a855f7';
      ctx.shadowBlur = 10;
    }
    ctx.fillRect(s.playerX, py, s.playerW, s.playerH);
    // Windshield
    ctx.fillStyle = 'rgba(0, 212, 255, 0.5)';
    ctx.fillRect(s.playerX + 5, py + 6, s.playerW - 10, 12);
    ctx.shadowBlur = 0;

    // HUD
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(10, h - 36, 340, 26);
    ctx.fillStyle = '#ff8800';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText(`Dodged: ${s.score}  |  Distance: ${Math.floor(s.distance)}m  |  Speed: ${s.speed.toFixed(1)}x`, 18, h - 18);

    if (crashed) {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 28px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('CRASHED', w / 2, h / 2);
      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.fillText('Use A/D or arrow keys to dodge obstacles', w / 2, h / 2 + 28);
      ctx.textAlign = 'left';
      s.speed = 3;
      s.distance = Math.max(0, s.distance - 50);
    }
  }

  // ── Astro Sweep Renderer ─────────────────────
  function renderAstroSweep(ctx, s, w, h) {
    // Starfield (scrolling)
    for (let i = 0; i < 40; i++) {
      const sx = (i * 97 + Math.sin(Date.now() / 1800 + i) * 15) % w;
      const sy = (i * 53 + Date.now() * 0.04) % (h - 30);
      ctx.fillStyle = i % 5 === 0 ? '#ffb000' : '#1f521f';
      ctx.fillRect(sx, sy, i % 5 === 0 ? 3 : 2, i % 5 === 0 ? 3 : 2);
    }

    // Ship movement
    if (s.keys['ArrowLeft'] || s.keys['a']) s.ship.x -= 6;
    if (s.keys['ArrowRight'] || s.keys['d']) s.ship.x += 6;
    if (s.keys['ArrowUp'] || s.keys['w']) s.ship.y -= 4;
    if (s.keys['ArrowDown'] || s.keys['s']) s.ship.y += 4;
    s.ship.x = Math.max(22, Math.min(w - 22, s.ship.x));
    s.ship.y = Math.max(120, Math.min(h - 40, s.ship.y));

    // Shooting
    s.coolDown--;
    if (s.coolDown <= 0 && s.keys[' ']) {
      s.bullets.push({ x: s.ship.x, y: s.ship.y - 22, vy: -10 });
      s.coolDown = 8;
    }

    // Bullets
    s.bullets = s.bullets.filter(b => {
      b.y += b.vy;
      if (b.y < 0) return false;
      let hit = false;
      s.rocks.forEach(r => {
        if (!r.dead && Math.abs(b.x - r.x) < r.r && Math.abs(b.y - r.y) < r.r) { r.dead = true; s.score++; hit = true; }
      });
      ctx.fillStyle = '#33ff00';
      ctx.shadowColor = '#33ff00';
      ctx.shadowBlur = 8;
      ctx.fillRect(b.x - 1, b.y - 8, 2, 12);
      ctx.shadowBlur = 0;
      return !hit;
    });

    // Spawn rocks
    if (Math.random() < 0.012 + s.score * 0.0001) {
      s.rocks.push({
        x: 30 + Math.random() * (w - 60), y: -30,
        r: 12 + Math.random() * 18,
        vx: (Math.random() - 0.5) * 2.4, vy: 1.8 + Math.random() * 2.2
      });
    }

    // Rocks
    s.rocks = s.rocks.filter(r => {
      if (r.dead) return false;
      r.x += r.vx; r.y += r.vy;
      if (r.y > h + 30 || r.x < -30 || r.x > w + 30) return false;
      const dx = r.x - s.ship.x, dy = r.y - s.ship.y;
      if (Math.sqrt(dx * dx + dy * dy) < r.r + 16) {
        s.lives--;
        s.rocks.forEach(o => { if (o !== r) o.dead = true; });
        if (s.lives <= 0) { s.lives = 3; if (s.score) s.score = 0; }
        return false;
      }
      ctx.strokeStyle = '#ffb000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r.x - r.r, r.y); ctx.lineTo(r.x + r.r, r.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r.x, r.y - r.r); ctx.lineTo(r.x, r.y + r.r); ctx.stroke();
      return true;
    });

    // Ship
    ctx.fillStyle = '#33ff00';
    ctx.shadowColor = '#33ff00';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(s.ship.x, s.ship.y - 20);
    ctx.lineTo(s.ship.x + 20, s.ship.y + 16);
    ctx.lineTo(s.ship.x, s.ship.y + 7);
    ctx.lineTo(s.ship.x - 20, s.ship.y + 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffb000';
    ctx.fillRect(s.ship.x - 3, s.ship.y + 4, 6, 10);
    ctx.shadowBlur = 0;

    // HUD
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, h - 36, 360, 26);
    ctx.fillStyle = '#33ff00';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText(`SCORE ${s.score}  |  LIVES ${s.lives}  |  [SPACE] FIRE  [WASD/ARROWS] MOVE`, 18, h - 18);
  }

  // ── GPU Furnace (fx-burst) Renderer ──────────
  function renderFxBurst(ctx, s, w, h) {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    const mx = s.mouse.x, my = s.mouse.y;
    const poked = s.poke && (Date.now() - s.poke) < 700;

    s.particles.forEach(p => {
      if (poked) {
        const dx = p.x - mx, dy = p.y - my;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = 2600 / (d * d);
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
      }
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.fillStyle = p.k > 0.9 ? '#ffb000' : p.k > 0.45 ? '#33ff00' : '#1f521f';
      ctx.fillRect(p.x, p.y, p.r, p.r);
    });

    // Pulse rings on click
    if (poked) {
      ctx.strokeStyle = 'rgba(255, 176, 0, 0.9)';
      ctx.lineWidth = 2;
      const ring = (Date.now() - s.poke) / 700;
      ctx.beginPath();
      ctx.arc(mx, my, 20 + ring * 120, 0, Math.PI * 2);
      ctx.stroke();
    }

    // HUD
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, h - 36, 380, 26);
    ctx.fillStyle = '#ffb000';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText(`GPU FURNACE :: ${s.particles.length.toLocaleString()} PARTICLES :: [CLICK] SHOCKWAVE`, 18, h - 18);
  }

  // ── Sysbar clock ─────────────────────────────
  function initClock() {
    const el = document.getElementById('sysbar-time');
    if (!el) return;
    const render = () => {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      el.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    render();
    setInterval(render, 1000);
  }

  // ── Typewriter tagline ───────────────────────
  const TYPE_TEXT = 'cloudplay v3.0 :: auth console online :: awaiting operator';
  function startTypewriter() {
    const el = document.getElementById('typewriter');
    if (!el) return;
    let i = 0;
    const tick = () => {
      el.textContent = TYPE_TEXT.slice(0, i++);
      if (i <= TYPE_TEXT.length) setTimeout(tick, 22);
    };
    setTimeout(tick, 400);
  }

  startTypewriter();
  initClock();
  bootstrapAuth();
})();
