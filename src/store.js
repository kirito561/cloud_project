'use strict';

// Storage abstraction for CloudPlay.
// - With MONGO_URI set: persists users, nodes, profiles and all sessions in MongoDB.
// - Without it: transparent in-memory fallback (current local behaviour).

function createMemoryStore(defaultCore) {
  return {
    kind: 'memory',
    async init() {},
    async loadCore() {
      return JSON.parse(JSON.stringify(defaultCore));
    },
    async listSessions() {
      return [];
    },
    async saveSession() {},
    async patchSession() {},
    async deleteSession() {},
    async close() {}
  };
}

function createMongoStore({ url, defaultCore, dbName = 'cloudplay' }) {
  let client = null;
  let db = null;

  function coreCol() { return db.collection('core'); }
  function sessionCol() { return db.collection('sessions'); }

  return {
    kind: 'mongodb',

    async init() {
      const { MongoClient } = require('mongodb');
      client = new MongoClient(url, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000
      });
      await client.connect();
      db = client.db(dbName);

      const existing = await coreCol().findOne({ _id: 'core' });
      if (!existing) {
        await coreCol().replaceOne(
          { _id: 'core' },
          { _id: 'core', ...JSON.parse(JSON.stringify(defaultCore)) },
          { upsert: true }
        );
      } else {
        // Reconcile defaults onto an already-seeded doc so profile upgrades
        // (new games, cover art, gpu flags) reach Mongo-backed deployments.
        const defaults = JSON.parse(JSON.stringify(defaultCore));
        const { _id, ...stored } = existing;
        const profiles = { ...(stored.profiles || {}) };
        for (const [key, def] of Object.entries(defaults.profiles || {})) {
          profiles[key] = profiles[key]
            ? { ...def, ...profiles[key] }
            : def;
        }
        const reconciled = { ...stored, profiles };
        await coreCol().replaceOne({ _id: 'core' }, { _id: 'core', ...reconciled }, { upsert: true });
      }
    },

    async loadCore() {
      const doc = await coreCol().findOne({ _id: 'core' });
      if (!doc) return JSON.parse(JSON.stringify(defaultCore));
      const { _id, ...core } = doc;
      return core;
    },

    async listSessions() {
      const docs = await sessionCol().find({}, { projection: { _id: 0 } }).toArray();
      return docs;
    },

    async saveSession(session) {
      await sessionCol().replaceOne(
        { _id: session.id },
        { _id: session.id, ...session },
        { upsert: true }
      );
    },

    async patchSession(id, patch) {
      await sessionCol().updateOne({ _id: id }, { $set: patch });
    },

    async deleteSession(id) {
      await sessionCol().deleteOne({ _id: id });
    },

    async close() {
      if (client) await client.close();
    }
  };
}

function createStore({ url, defaultCore, dbName }) {
  if (url && /^mongodb(\+srv)?:\/\//.test(url)) {
    return createMongoStore({ url, defaultCore, dbName });
  }
  return createMemoryStore(defaultCore);
}

module.exports = { createStore };