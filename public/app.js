let currentSession = null;
let gameLoopId = null;

async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (res.ok) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    setInterval(refreshDashboard, 2000);
    refreshDashboard();
  } else {
    alert('Invalid demo credentials.');
  }
}

function logout() {
  window.location.reload();
}

async function refreshDashboard() {
  const res = await fetch('/api/state');
  const data = await res.json();

  // Render Nodes
  const nodesContainer = document.getElementById('nodes-container');
  nodesContainer.innerHTML = data.nodes.map(node => `
    <div class="node-box">
      <strong>${node.id} (${node.region})</strong>
      <div>CPU: ${node.used.cpu} / ${node.capacity.cpu} vCPUs</div>
      <div class="progress-bar"><div class="progress-fill" style="width: ${(node.used.cpu/node.capacity.cpu)*100}%"></div></div>
      <div>RAM: ${node.used.ram} / ${node.capacity.ram} GB</div>
      <div class="progress-bar"><div class="progress-fill" style="width: ${(node.used.ram/node.capacity.ram)*100}%"></div></div>
      <div>GPU: ${node.used.gpu} / ${node.capacity.gpu} Instances</div>
      <div class="progress-bar"><div class="progress-fill" style="width: ${(node.capacity.gpu ? node.used.gpu/node.capacity.gpu : 0)*100}%"></div></div>
    </div>
  `).join('');

  // Render Sessions
  const sessionsContainer = document.getElementById('sessions-container');
  sessionsContainer.innerHTML = data.sessions.map(s => `
    <div class="session-item">
      <span><b>${s.name}</b> (${s.id}) - Status: <i>${s.status}</i> on [${s.nodeId}]</span>
      <div style="margin-top: 5px;">
        ${s.status === 'running' ? `<button onclick="launchStream('${s.profileKey}', '${s.name}')">Stream Game</button>` : ''}
        <button style="background: #da3633" onclick="terminate('${s.id}')">Kill Session</button>
      </div>
    </div>
  `).join('');
}

async function startSession(profileKey) {
  const res = await fetch('/api/sessions/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileKey })
  });
  if (!res.ok) alert((await res.json()).error);
  refreshDashboard();
}

async function terminate(sessionId) {
  await fetch('/api/sessions/terminate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId })
  });
  if (currentSession === sessionId) closeStream();
  refreshDashboard();
}

// ---------------------------------------------
// Interactive 3-Profile Canvas Streaming Engine
// ---------------------------------------------
function launchStream(profileKey, name) {
  const container = document.getElementById('stream-container');
  container.classList.remove('hidden');
  document.getElementById('active-game-title').innerText = `Remote View: ${name}`;

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  if (gameLoopId) cancelAnimationFrame(gameLoopId);

  let state = {};
  if (profileKey === 'demo-arena') {
    state = { x: 50, y: 150, target: { x: 550, y: 150 }, keys: {} };
  } else if (profileKey === 'valorant-lab') {
    state = { targets: [{x: 400, y: 100}, {x: 300, y: 200}, {x: 450, y: 250}], mouse: {x: 0, y: 0}, score: 0 };
  } else if (profileKey === 'racing-lab') {
    state = { playerX: 300, obstacles: [{x: 200, y: 0}, {x: 400, y: -150}], speed: 4 };
  }

  window.onkeydown = e => { if (state.keys) state.keys[e.key] = true; };
  window.onkeyup = e => { if (state.keys) state.keys[e.key] = false; };
  canvas.onmousemove = e => {
    const rect = canvas.getBoundingClientRect();
    state.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (profileKey === 'demo-arena') {
      if (state.keys['ArrowRight'] || state.keys['d']) state.x += 3;
      if (state.keys['ArrowLeft'] || state.keys['a']) state.x -= 3;
      if (state.keys['ArrowUp'] || state.keys['w']) state.y -= 3;
      if (state.keys['ArrowDown'] || state.keys['s']) state.y += 3;

      // Draw beacon
      ctx.fillStyle = '#2ea043';
      ctx.fillRect(state.target.x, state.target.y, 30, 30);

      // Draw character
      ctx.fillStyle = '#58a6ff';
      ctx.fillRect(state.x, state.y, 20, 20);

      ctx.fillStyle = 'white';
      ctx.fillText('WASD / Arrows to move character to the beacon', 20, 20);
    } else if (profileKey === 'valorant-lab') {
      // Draw crosshair
      ctx.strokeStyle = '#39d353';
      ctx.beginPath();
      ctx.arc(state.mouse.x, state.mouse.y, 10, 0, Math.PI * 2);
      ctx.stroke();

      // Draw target drones
      ctx.fillStyle = '#f85149';
      state.targets.forEach(t => ctx.fillRect(t.x, t.y, 24, 24));
      ctx.fillStyle = 'white';
      ctx.fillText('Move cursor to aim remote stream at targets', 20, 20);
    } else if (profileKey === 'racing-lab') {
      // Draw track lines
      ctx.strokeStyle = '#30363d';
      ctx.strokeRect(100, 0, 440, 360);

      // Move obstacles down
      state.obstacles.forEach(obs => {
        obs.y += state.speed;
        if (obs.y > 360) { obs.y = -20; obs.x = 120 + Math.random() * 380; }
        ctx.fillStyle = '#f0883e';
        ctx.fillRect(obs.x, obs.y, 25, 25);
      });

      // Player car
      ctx.fillStyle = '#a371f7';
      ctx.fillRect(state.playerX, 300, 30, 40);
      ctx.fillStyle = 'white';
      ctx.fillText('Dynamic Racing Simulation Profile (Simulated Load Active)', 20, 20);
    }

    gameLoopId = requestAnimationFrame(render);
  }

  render();
}

function closeStream() {
  document.getElementById('stream-container').classList.add('hidden');
  if (gameLoopId) cancelAnimationFrame(gameLoopId);
}