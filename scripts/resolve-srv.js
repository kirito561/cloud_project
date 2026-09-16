'use strict';

// Converts a mongodb+srv:// Atlas URI into a direct mongodb:// URI.
//
// Atlas uses SRV DNS records for cluster shard discovery. Some networks/
// hosts refuse SRV queries (ECONNREFUSED). A direct URI lists the actual
// shard addresses instead, so it works anywhere.
//
// Since the local resolver may be the problem, this tool resolves records
// via DNS-over-HTTPS (https://dns.google) and falls back to node:dns.
//
// Usage:
//   node scripts/resolve-srv.js "mongodb+srv://user:pass@cluster0.kucga5i.mongodb.net/?retryWrites=true&w=majority"

async function dohJson(type, name) {
  const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`);
  if (!res.ok) throw new Error(`DoH request failed: ${res.status}`);
  return res.json();
}

async function resolveSrv(host) {
  try {
    const json = await dohJson('SRV', `_mongodb._tcp.${host}`);
    if (json.Answer && json.Answer.length) {
      return json.Answer.map(a => {
        const m = a.data.match(/^\d+ \d+ (\d+) (.+?)\.?$/);
        if (!m) throw new Error(`Cannot parse SRV record: ${a.data}`);
        return { port: Number(m[1]), host: m[2] };
      });
    }
  } catch {}
  const dns = require('dns');
  const records = await dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
  return records.map(r => ({ port: r.port, host: r.name }));
}

async function resolveTxt(host) {
  try {
    const json = await dohJson('TXT', host);
    const params = new URLSearchParams();
    for (const a of json.Answer || []) {
      const s = a.data.replace(/^"|"$/g, '').replace(/""/g, '"');
      try {
        const usp = new URLSearchParams(s);
        for (const key of usp.keys()) params.set(key, usp.get(key));
      } catch {}
    }
    if ([...params.keys()].length) return params;
  } catch {}
  const dns = require('dns');
  const records = await dns.promises.resolveTxt(host);
  const params = new URLSearchParams();
  for (const chunk of records) {
    const s = chunk.join('');
    try {
      const usp = new URLSearchParams(s);
      for (const key of usp.keys()) params.set(key, usp.get(key));
    } catch {}
  }
  return params;
}

async function main() {
  const uri = process.argv[2] || process.env.MONGO_URI;
  if (!uri || !uri.startsWith('mongodb+srv://')) {
    console.error('Usage: node scripts/resolve-srv.js "mongodb+srv://user:pass@<cluster>.mongodb.net/?retryWrites=true&w=majority"');
    process.exit(1);
  }

  const u = new URL(uri);
  const host = u.hostname;
  const auth = u.username || u.password
    ? `${encodeURIComponent(u.username)}:${encodeURIComponent(u.password)}@`
    : '';

  const targets = await resolveSrv(host);
  if (!targets.length) {
    console.error(`No SRV records found for ${host}`);
    process.exit(1);
  }

  const hosts = targets.map(t => `${t.host}:${t.port}`);

  const params = await resolveTxt(host);
  params.set('tls', 'true');
  for (const [key, value] of u.searchParams) {
    if (!params.has(key)) params.set(key, value);
  }

  const direct = `mongodb://${auth}${hosts.join(',')}?${params.toString()}`;
  console.log('\nDirect connection string (set this as MONGO_URI):\n');
  console.log(direct);
  console.log('\nKeep it secret — it contains your database password.');
}

main().catch(err => {
  console.error('Resolution failed:', err.message);
  process.exit(1);
});