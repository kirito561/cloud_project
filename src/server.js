'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { usage, selectNode, resizeAllowed } = require('./allocator');
const { createStore } = require('./store');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Optional .env loader (KEY=VALUE lines) — never overrides real environment vars.
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    });
  }
} catch { /* ignore */ }

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

// Defaults used to seed persistent storage on first boot.
const DEFAULT_CORE = {
  users: [{
    id: 'u-1',
    email: 'student@cloudplay.local',
    passwordHash: hashPassword('cloudplay123')
  }],
  nodes: [
    { id: 'edge-node-01', region: 'us-east-edge', status: 'ready', capacity: { cpu: 16, ram: 64, gpu: 4 } },
    { id: 'edge-node-02', region: 'us-west-edge', status: 'ready', capacity: { cpu: 8, ram: 32, gpu: 2 } }
  ],
  profiles: {
    'valorant-lab': { name: 'Valorant FPS Lab', cpu: 4, ram: 8, gpu: 1, description: 'High-FPS tactical shooter simulation', category: 'original', cover: '/img/covers/valorant-lab.svg' },
    'racing-lab': { name: 'Cyber Racing Lab', cpu: 6, ram: 16, gpu: 2, description: 'GPU-intensive racing simulation', category: 'original', cover: '/img/covers/racing-lab.svg', gpuHeavy: true },
    'astro-sweep': {
      name: 'Astro Sweep', cpu: 3, ram: 6, gpu: 2, category: 'original', gpuHeavy: true,
      description: 'GPU-raster space shooter — dodge rocks, fire lasers',
      cover: '/img/covers/astro-sweep.svg'
    },
    'fx-burst': {
      name: 'GPU Furnace', cpu: 2, ram: 4, gpu: 3, category: 'original', gpuHeavy: true,
      description: '12,000-particle GPU stress furnace — click for shockwaves',
      cover: '/img/covers/fx-burst.svg'
    },
    'open-2048': {
      name: 'Blocky 2048', cpu: 2, ram: 4, gpu: 0, category: 'web',
      description: 'Slide tiles to merge into 2048',
      source: '/games/2048/index.html',
      cover: '/img/covers/open-2048.svg',
      license: 'MIT', author: 'Gabriele Cirulli'
    },
    'open-dino': {
      name: 'Chrome Dino Run', cpu: 2, ram: 4, gpu: 0, category: 'web',
      description: 'Endless runner — jump the cacti',
      source: '/games/dino/index.html',
      cover: '/img/covers/open-dino.svg',
      license: 'BSD-3-Clause', author: 'wayou'
    },
    'open-hextris': {
      name: 'Hextris Blocks', cpu: 4, ram: 8, gpu: 1, category: 'web',
      description: 'Fast-paced hexagonal Tetris',
      source: '/games/hextris/index.html',
      cover: '/img/covers/open-hextris.svg',
      license: 'GPL-3.0', author: 'Hextris Team'
    }
  }
};

const state = { ...JSON.parse(JSON.stringify(DEFAULT_CORE)), sessions: [] };

const store = createStore({ url: process.env.MONGO_URI, defaultCore: DEFAULT_CORE });

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { req.destroy(); resolve({}); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ── Google OAuth -------------------------------
// Real OAuth flow when GOOGLE_CLIENT_ID/SECRET are set (Render env).
// Without them the app runs in demo mode: the sign-in button provisions the
// seed demo account directly so the prototype stays usable offline.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const DEMO_EMAIL = 'student@cloudplay.local';
const oauthStates = new Map();
const authSessions = new Map();

function issueSession(user, method) {
  const token = crypto.randomBytes(24).toString('hex');
  authSessions.set(token, {
    email: user.email,
    name: user.name || '',
    picture: user.picture || '',
    method: method || 'google',
    createdAt: Date.now()
  });
  return token;
}

function readCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > -1) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token, secure) {
  res.setHeader('Set-Cookie', `cp_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'cp_session=; Path=/; HttpOnly; Max-Age=0');
}

function oauthRedirectBase(req) {
  const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers.host}/api/auth/google/callback`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // ── Google OAuth endpoints ────────────────────
  if (url.pathname === '/api/auth/config' && req.method === 'GET') {
    return sendJSON(res, 200, { googleConfigured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });
  }

  if (url.pathname === '/api/auth/google' && req.method === 'GET') {
    const secure = (req.headers['x-forwarded-proto'] || 'http') === 'https';
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      // Demo mode: no OAuth credentials — provision the seed account directly.
      const token = issueSession({ email: DEMO_EMAIL, name: 'CloudPlay Demo' }, 'demo');
      setSessionCookie(res, token, secure);
      res.writeHead(302, { Location: '/?ok=1' });
      return res.end();
    }
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, Date.now());
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: oauthRedirectBase(req),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account'
    });
    res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    return res.end();
  }

  if (url.pathname === '/api/auth/google/callback' && req.method === 'GET') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const issued = oauthStates.get(state || '');
    oauthStates.delete(state || '');
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !issued || !code || Date.now() - issued > 600000) {
      res.writeHead(302, { Location: '/?auth=1' });
      return res.end();
    }
    try {
      const tokRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: oauthRedirectBase(req),
          grant_type: 'authorization_code'
        })
      });
      const tok = await tokRes.json();
      if (!tok.access_token) {
        res.writeHead(302, { Location: '/?auth=2' });
        return res.end();
      }
      const uiRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tok.access_token}` }
      });
      const info = await uiRes.json();
      if (!info.email) {
        res.writeHead(302, { Location: '/?auth=3' });
        return res.end();
      }
      const token = issueSession(
        { email: info.email, name: info.name || info.email, picture: info.picture || '' },
        'google'
      );
      setSessionCookie(res, token, true);
      res.writeHead(302, { Location: '/?ok=1' });
      return res.end();
    } catch {
      res.writeHead(302, { Location: '/?auth=4' });
      return res.end();
    }
  }

  if (url.pathname === '/api/session' && req.method === 'GET') {
    const token = readCookies(req).cp_session;
    const sess = token ? authSessions.get(token) : null;
    if (!sess) return sendJSON(res, 200, { user: null });
    return sendJSON(res, 200, {
      user: { email: sess.email, name: sess.name, picture: sess.picture },
      method: sess.method
    });
  }

  if (url.pathname === '/api/logout' && (req.method === 'POST' || req.method === 'GET')) {
    const token = readCookies(req).cp_session;
    if (token) authSessions.delete(token);
    clearSessionCookie(res);
    return sendJSON(res, 200, { success: true });
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const { email, password } = await parseBody(req);
    if (!email || !password) return sendJSON(res, 400, { error: 'Email and password required' });
    const user = state.users.find(u => u.email === email && u.passwordHash === hashPassword(password));
    if (!user) return sendJSON(res, 401, { error: 'Invalid credentials' });
    const token = crypto.randomBytes(16).toString('hex');
    return sendJSON(res, 200, { token, user: { id: user.id, email: user.email } });
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const enrichedNodes = state.nodes.map(n => ({
      ...n,
      used: usage(n, state.sessions)
    }));
    return sendJSON(res, 200, { nodes: enrichedNodes, sessions: state.sessions, profiles: state.profiles });
  }

  if (url.pathname === '/api/sessions/create' && req.method === 'POST') {
    const { profileKey } = await parseBody(req);
    if (!profileKey) return sendJSON(res, 400, { error: 'profileKey is required' });
    const profile = state.profiles[profileKey];
    if (!profile) return sendJSON(res, 400, { error: 'Invalid game profile' });

    const targetNode = selectNode(state.nodes, state.sessions, profile);
    if (!targetNode) return sendJSON(res, 503, { error: 'No compute capacity available. Try terminating an existing session.' });

    const newSession = {
      id: 'sess-' + crypto.randomBytes(3).toString('hex'),
      profileKey,
      name: profile.name,
      nodeId: targetNode.id,
      nodeRegion: targetNode.region,
      resources: { cpu: profile.cpu, ram: profile.ram, gpu: profile.gpu },
      status: 'provisioning',
      createdAt: Date.now(),
      uptime: 0
    };
    state.sessions.push(newSession);
    store.saveSession(newSession).catch(() => {});

    // Simulate VM boot latency
    setTimeout(() => {
      newSession.status = 'running';
      store.patchSession(newSession.id, { status: 'running' }).catch(() => {});
    }, 1800);
    return sendJSON(res, 201, newSession);
  }

  if (url.pathname === '/api/sessions/resize' && req.method === 'POST') {
    const { sessionId, nextResources } = await parseBody(req);
    if (!sessionId || !nextResources) return sendJSON(res, 400, { error: 'sessionId and nextResources required' });
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return sendJSON(res, 404, { error: 'Session not found' });
    if (session.status !== 'running') return sendJSON(res, 409, { error: 'Can only resize running sessions' });

    const node = state.nodes.find(n => n.id === session.nodeId);
    if (!node || !resizeAllowed(node, state.sessions, session, nextResources)) {
      return sendJSON(res, 409, { error: 'Node capacity exceeded for resize' });
    }

    session.resources = { ...nextResources };
    store.patchSession(session.id, { resources: { ...nextResources } }).catch(() => {});
    return sendJSON(res, 200, session);
  }

  if (url.pathname === '/api/sessions/terminate' && req.method === 'POST') {
    const { sessionId } = await parseBody(req);
    if (!sessionId) return sendJSON(res, 400, { error: 'sessionId is required' });
    const existed = state.sessions.some(s => s.id === sessionId);
    state.sessions = state.sessions.filter(s => s.id !== sessionId);
    store.deleteSession(sessionId).catch(() => {});
    return sendJSON(res, 200, { success: true, terminated: existed });
  }

  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404 Not Found</h1>');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other CloudPlay process first, or set PORT=<other> to use a different port.`);
    process.exit(1);
  }
  throw err;
});

async function boot() {
  await store.init();
  const core = await store.loadCore();
  state.users = core.users;
  state.nodes = core.nodes;
  state.profiles = core.profiles;
  state.sessions = await store.listSessions();
  console.log(`Storage: ${store.kind === 'mongodb' ? 'MongoDB (persistent)' : 'in-memory (set MONGO_URI for persistence)'}`);

  server.listen(PORT, () => console.log(`CloudPlay running at http://localhost:${PORT}`));
}

function shutdown() {
  console.log('\nShutting down...');
  store.close()
    .then(() => process.exit(0))
    .catch(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

boot().catch(err => {
  console.error('Failed to start:', err.message);
  if (/querySrv|SRV|ECONNREFUSED/i.test(err.message + err.stack)) {
    console.error('\nHint: your network is refusing MongoDB SRV (DNS) lookups. Convert your mongodb+srv:// URI to a direct mongodb:// URI and set it as MONGO_URI:');
    console.error('  node scripts/resolve-srv.js "mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority"');
  }
  process.exit(1);
});