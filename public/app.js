(() => {
  'use strict';

  let currentSession = null;
  let gameLoopId = null;
  let refreshInterval = null;
  let keyHandlers = null;
  let resizeHandler = null;
  let PROFILES = {};
  let currentProfileKey = null;

  // ── Toast System ─────────────────────────────
  function toast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icons = { success: '\u2713', error: '\u2717', info: '\u2139' };
    el.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-msg">${escapeHtml(message)}</span>
      <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    container.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'slideOutRight 0.3s ease-in forwards';
      el.addEventListener('animationend', () => el.remove());
    }, duration);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Auth ─────────────────────────────────────
  window.login = async function () {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const btn = document.getElementById('login-btn');

    if (!email || !password) {
      toast('Please enter email and password', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (res.ok) {
        const data = await res.json();
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('dashboard-screen').classList.remove('hidden');
        toast(`Welcome back, ${data.user.email}`, 'success');
        refreshDashboard();
        refreshInterval = setInterval(refreshDashboard, 3000);
      } else {
        const err = await res.json();
        toast(err.error || 'Invalid credentials', 'error');
      }
    } catch {
      toast('Connection failed. Is the server running?', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  };

  window.logout = function () {
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    closeStream();
    window.location.reload();
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
      renderNodes(data.nodes);
      renderSessions(data.sessions);
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
    container.innerHTML = nodes.map(node => `
      <div class="node-card">
        <div class="node-header">
          <div>
            <div class="node-id">${escapeHtml(node.id)}</div>
            <div class="node-region">${escapeHtml(node.region)}</div>
          </div>
          <span class="status-badge">${node.status}</span>
        </div>
        ${renderResourceRow('CPU', node.used.cpu, node.capacity.cpu)}
        ${renderResourceRow('RAM', node.used.ram, node.capacity.ram)}
        ${renderResourceRow('GPU', node.used.gpu, node.capacity.gpu)}
      </div>
    `).join('');
  }

  function renderResourceRow(label, used, total) {
    const pct = total ? Math.round((used / total) * 100) : 0;
    const level = resourceLevel(used, total);
    return `
      <div class="resource-row">
        <span class="resource-label">${label}</span>
        <div class="progress-bar">
          <div class="progress-fill ${level}" style="width: ${pct}%"></div>
        </div>
        <span class="resource-value">${used} / ${total}</span>
      </div>
    `;
  }

  function renderSessions(sessions) {
    const container = document.getElementById('sessions-container');
    if (!sessions.length) {
      container.innerHTML = '<div class="empty-state">No active sessions. Launch a workload above to get started.</div>';
      return;
    }
    container.innerHTML = sessions.map(s => {
      const uptime = s.createdAt ? formatUptime(Date.now() - s.createdAt) : '--';
      const r = s.resources;
      return `
        <div class="session-card ${s.status}">
          <div class="session-info">
            <span class="session-name">${escapeHtml(s.name)}</span>
            <span class="session-meta">${escapeHtml(s.id)} &middot; ${escapeHtml(s.nodeId)} &middot; ${uptime}</span>
            <span class="session-meta">${r.cpu} vCPU &middot; ${r.ram} GB &middot; ${r.gpu} GPU</span>
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
                <span class="stepper-hint">Reclaim a resource down to 0 to auto-terminate</span>
              </div>` : ''}
          </div>
          <span class="session-status ${s.status}">${s.status}</span>
          <div class="session-actions">
            ${s.status === 'running'
              ? `<button class="btn-accent" onclick="window._launchStream('${s.profileKey}', '${escapeHtml(s.name)}')">Stream</button>`
              : ''}
            <button class="btn-danger" onclick="window._terminate('${s.id}')">Terminate</button>
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
          ${group.map(([key, p]) => `
            <div class="launch-btn" onclick="window._startSession('${key}')">
              <div>
                <div class="game-name">${escapeHtml(p.name)}</div>
                <div class="game-specs">${specsText(p)}</div>
                ${p.description ? `<div class="game-desc">${escapeHtml(p.description)}</div>` : ''}
                ${p.license ? `<div class="game-license">${escapeHtml(p.author || '')} &middot; ${escapeHtml(p.license)}</div>` : ''}
              </div>
              <span class="game-arrow">&rsaquo;</span>
            </div>
          `).join('')}
        </div>`
      : '';

    container.innerHTML = block(original, 'Built-in Simulations') + block(web, 'Open-Source Web Games');
  }

  function specsText(p) {
    const parts = [`${p.cpu} vCPU`, `${p.ram} GB RAM`];
    if (p.gpu > 0) parts.push(`${p.gpu} GPU`);
    return parts.join(' &middot; ');
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
    document.getElementById('active-game-title').textContent = `Remote View: ${name}`;
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (profile && profile.category === 'web' && profile.source) {
      launchExternalStream(profile.source, name);
    } else {
      launchCanvasStream(profileKey, name);
    }

    currentSession = name;
    startLatencySim();
  };

  function startLatencySim() {
    stopLatencySim();
    const latEl = document.getElementById('latency-badge');
    if (!latEl) return;
    latencyTimer = setInterval(() => {
      latEl.textContent = `~${8 + Math.floor(Math.random() * 8)}ms`;
    }, 2000);
  }

  function stopLatencySim() {
    if (latencyTimer) { clearInterval(latencyTimer); latencyTimer = null; }
  }

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
    }

    function render() {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (profileKey === 'valorant-lab') renderValorantLab(ctx, state, w, h);
      else if (profileKey === 'racing-lab') renderRacingLab(ctx, state, w, h);

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

  // ── Handle Enter key on login ────────────────
  document.getElementById('password').addEventListener('keydown', e => {
    if (e.key === 'Enter') window.login();
  });
  document.getElementById('email').addEventListener('keydown', e => {
    if (e.key === 'Enter') window.login();
  });
})();
