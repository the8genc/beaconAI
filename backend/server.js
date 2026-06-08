/**
 * BeaconAI Backend - ZeroDB-only prototype
 *
 * Lightweight Express server that proxies to ZeroDB NoSQL tables.
 * No ORM, no migrations - just ZeroDB.
 */

// Load .env
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && key.trim() && !key.startsWith('#')) {
      process.env[key.trim()] = vals.join('=').trim();
    }
  });
}

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const zerodb = require('./zerodb');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ─── Health ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'beaconai-backend', timestamp: new Date().toISOString() });
});

// ─── Profiles ───────────────────────────────────────────

// Create or update profile (upsert by user_id)
app.post('/api/profiles', async (req, res) => {
  try {
    const { uuid, name, role, company, avatarUri, socialLinks, interestTags } = req.body;
    if (!uuid) return res.status(400).json({ error: 'uuid is required' });

    // Check if profile exists
    const existing = await zerodb.query('beacon_profiles', { user_id: uuid });
    const profileData = {
      user_id: uuid,
      name: name || '',
      role: role || '',
      company: company || '',
      avatar_uri: avatarUri || '',
      social_links: socialLinks || {},
      interest_tags: interestTags || [],
      last_updated: new Date().toISOString(),
    };

    let result;
    if (existing.rows && existing.rows.length > 0) {
      result = await zerodb.update('beacon_profiles', existing.rows[0].id, profileData);
    } else {
      result = await zerodb.insert('beacon_profiles', profileData);
    }
    res.json(result);
  } catch (err) {
    console.error('POST /api/profiles error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get profile by user_id
app.get('/api/profiles/:userId', async (req, res) => {
  try {
    const result = await zerodb.query('beacon_profiles', { user_id: req.params.userId });
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/profiles error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// List all profiles (for discovery)
app.get('/api/profiles', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;
    const result = await zerodb.query('beacon_profiles', {}, { limit, skip });
    res.json(result);
  } catch (err) {
    console.error('GET /api/profiles error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Peers ──────────────────────────────────────────────

// Record a discovered peer
app.post('/api/peers', async (req, res) => {
  try {
    const { peerId, name, role, company, rssi, sessionId, discoveredBy } = req.body;
    if (!peerId) return res.status(400).json({ error: 'peerId is required' });

    const peerData = {
      peer_id: peerId,
      discovered_by: discoveredBy || '',
      name: name || '',
      role: role || '',
      company: company || '',
      rssi: rssi || 0,
      session_id: sessionId || '',
      discovered_at: new Date().toISOString(),
      contact_saved: false,
    };
    const result = await zerodb.insert('beacon_peers', peerData);
    res.json(result);
  } catch (err) {
    console.error('POST /api/peers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get peers discovered by a user
app.get('/api/peers/:userId', async (req, res) => {
  try {
    const result = await zerodb.query('beacon_peers', { discovered_by: req.params.userId }, {
      sort: { discovered_at: -1 },
      limit: parseInt(req.query.limit) || 50,
    });
    res.json(result);
  } catch (err) {
    console.error('GET /api/peers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Save a peer contact
app.put('/api/peers/:rowId/save', async (req, res) => {
  try {
    const result = await zerodb.update('beacon_peers', req.params.rowId, { contact_saved: true });
    res.json(result);
  } catch (err) {
    console.error('PUT /api/peers save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Sessions ───────────────────────────────────────────

// Start a discovery session
app.post('/api/sessions', async (req, res) => {
  try {
    const { userId, mode, roomCode, sessionName } = req.body;
    const sessionData = {
      session_id: crypto.randomUUID(),
      user_id: userId || '',
      started_at: new Date().toISOString(),
      ended_at: null,
      mode: mode || 'default',
      room_code: roomCode || '',
      session_name: sessionName || '',
      peer_ids: [],
    };
    const result = await zerodb.insert('beacon_sessions', sessionData);
    res.json(result);
  } catch (err) {
    console.error('POST /api/sessions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// End a session
app.put('/api/sessions/:rowId/end', async (req, res) => {
  try {
    const result = await zerodb.update('beacon_sessions', req.params.rowId, {
      ended_at: new Date().toISOString(),
    });
    res.json(result);
  } catch (err) {
    console.error('PUT /api/sessions end error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get sessions for a user
app.get('/api/sessions/:userId', async (req, res) => {
  try {
    const result = await zerodb.query('beacon_sessions', { user_id: req.params.userId }, {
      sort: { started_at: -1 },
      limit: parseInt(req.query.limit) || 20,
    });
    res.json(result);
  } catch (err) {
    console.error('GET /api/sessions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Connections ────────────────────────────────────────

// Log a connection/interaction
app.post('/api/connections', async (req, res) => {
  try {
    const { peerId, sessionId, userId, interactionType, notes } = req.body;
    const logData = {
      log_id: crypto.randomUUID(),
      peer_id: peerId || '',
      session_id: sessionId || '',
      user_id: userId || '',
      saved: interactionType === 'saved',
      notes: notes || '',
      interaction_type: interactionType || 'viewed',
      timestamp: new Date().toISOString(),
    };
    const result = await zerodb.insert('beacon_connections', logData);
    res.json(result);
  } catch (err) {
    console.error('POST /api/connections error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get connection history for a user
app.get('/api/connections/:userId', async (req, res) => {
  try {
    const result = await zerodb.query('beacon_connections', { user_id: req.params.userId }, {
      sort: { timestamp: -1 },
      limit: parseInt(req.query.limit) || 50,
    });
    res.json(result);
  } catch (err) {
    console.error('GET /api/connections error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`BeaconAI backend running on http://localhost:${PORT}`);
  console.log(`ZeroDB Project: ${process.env.ZERODB_PROJECT_ID}`);
});
