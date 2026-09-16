'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { usage, selectNode, resizeAllowed } = require('./allocator');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const state = {
  users: [{ id: 'u-1', email: 'student@cloudplay.local', passwordHash: 'cloudplay123' }],
  sessions: [],
  nodes: [
    { id: 'edge-node-01', region: 'us-east-edge', status: 'ready', capacity: { cpu: 16, ram: 64, gpu: 4 } },
    { id: 'edge-node-02', region: 'us-west-edge', status: 'ready', capacity: { cpu: 8, ram: 32, gpu: 2 } }
  ],
  profiles: {
    'demo-arena': { name: 'Demo Arena', cpu: 2, ram: 4, gpu: 0 },
    'valorant-lab': { name: 'Valorant FPS Lab', cpu: 4, ram: 8, gpu: 1 },
    'racing-lab': { name: 'Cyber Racing Lab', cpu: 6, ram: 16, gpu: 2 }
  }
};

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // API Endpoints
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const { email, password } = await parseBody(req);
    const user = state.users.find(u => u.email === email && u.passwordHash === password);
    if (!user) return sendJSON(res, 401, { error: 'Invalid credentials' });
    return sendJSON(res, 200, { token: 'mock-session-token', user: { email: user.email } });
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
    const profile = state.profiles[profileKey];
    if (!profile) return sendJSON(res, 400, { error: 'Invalid game profile' });

    const targetNode = selectNode(state.nodes, state.sessions, profile);
    if (!targetNode) return sendJSON(res, 503, { error: 'No compute capacity available' });

    const newSession = {
      id: 'sess-' + crypto.randomBytes(3).toString('hex'),
      profileKey,
      name: profile.name,
      nodeId: targetNode.id,
      resources: { ...profile },
      status: 'provisioning',
      createdAt: Date.now()
    };
    state.sessions.push(newSession);

    // Simulate VM boot latency
    setTimeout(() => { newSession.status = 'running'; }, 1800);
    return sendJSON(res, 201, newSession);
  }

  if (url.pathname === '/api/sessions/resize' && req.method === 'POST') {
    const { sessionId, nextResources } = await parseBody(req);
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return sendJSON(res, 404, { error: 'Session not found' });

    const node = state.nodes.find(n => n.id === session.nodeId);
    if (!resizeAllowed(node, state.sessions, session, nextResources)) {
      return sendJSON(res, 409, { error: 'Node capacity exceeded for resize' });
    }

    session.resources = nextResources;
    return sendJSON(res, 200, session);
  }

  if (url.pathname === '/api/sessions/terminate' && req.method === 'POST') {
    const { sessionId } = await parseBody(req);
    state.sessions = state.sessions.filter(s => s.id !== sessionId);
    return sendJSON(res, 200, { success: true });
  }

  // Static File Server
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`CloudPlay running at http://localhost:${PORT}`));