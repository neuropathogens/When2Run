'use strict';

const path = require('path');
const express = require('express');
const { db, shortId, token, hashPin, PALETTE } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function now() { return Date.now(); }

function bump(eventId) {
  db.prepare('UPDATE events SET version = version + 1 WHERE id = ?').run(eventId);
}

function getEventRow(id) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

function pickColor(eventId) {
  const used = new Set(
    db.prepare('SELECT color FROM participants WHERE event_id = ?').all(eventId).map(r => r.color)
  );
  for (const c of PALETTE) if (!used.has(c)) return c;
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

// Build the full public snapshot of an event (safe to send to any viewer).
function buildSnapshot(id) {
  const ev = getEventRow(id);
  if (!ev) return null;

  const participants = db.prepare(
    'SELECT id, name, color, pace_seconds, distance_km, rsvp, created_at, (pin_hash IS NOT NULL) AS locked FROM participants WHERE event_id = ? ORDER BY created_at'
  ).all(id);

  const availRows = db.prepare(
    `SELECT a.participant_id AS pid, a.slot AS slot
       FROM availability a JOIN participants p ON p.id = a.participant_id
      WHERE p.event_id = ?`
  ).all(id);

  const availability = {}; // slot -> [pid...]
  for (const r of availRows) (availability[r.slot] ||= []).push(r.pid);

  const locations = db.prepare('SELECT * FROM locations WHERE event_id = ? ORDER BY created_at').all(id);
  const locVotes = db.prepare(
    `SELECT lv.location_id AS lid, lv.participant_id AS pid
       FROM location_votes lv JOIN locations l ON l.id = lv.location_id
      WHERE l.event_id = ?`
  ).all(id);
  const locVoteMap = {};
  for (const v of locVotes) (locVoteMap[v.lid] ||= []).push(v.pid);
  for (const l of locations) l.votes = locVoteMap[l.id] || [];

  const routes = db.prepare('SELECT * FROM routes WHERE event_id = ? ORDER BY created_at').all(id);
  const routeVotes = db.prepare(
    `SELECT rv.route_id AS rid, rv.participant_id AS pid
       FROM route_votes rv JOIN routes r ON r.id = rv.route_id
      WHERE r.event_id = ?`
  ).all(id);
  const routeVoteMap = {};
  for (const v of routeVotes) (routeVoteMap[v.rid] ||= []).push(v.pid);
  for (const r of routes) r.votes = routeVoteMap[r.id] || [];

  const comments = db.prepare('SELECT id, participant_id, author, body, created_at FROM comments WHERE event_id = ? ORDER BY created_at').all(id);

  return {
    id: ev.id,
    title: ev.title,
    description: ev.description,
    timezone: ev.timezone,
    dateType: ev.date_type,
    dates: JSON.parse(ev.dates_json),
    timeStart: ev.time_start,
    timeEnd: ev.time_end,
    slotMinutes: ev.slot_minutes,
    paceUnit: ev.pace_unit,
    finalizedSlot: ev.finalized_slot,
    version: ev.version,
    createdAt: ev.created_at,
    stravaEnabled: Boolean(process.env.STRAVA_CLIENT_ID),
    participants: participants.map(p => ({ ...p, locked: Boolean(p.locked) })),
    availability,
    locations,
    routes,
    comments,
  };
}

// Resolve & authorize a participant from the bearer-ish token header.
function authParticipant(req, eventId) {
  const tok = req.get('x-participant-token') || (req.body && req.body.token);
  if (!tok) return null;
  const p = db.prepare('SELECT * FROM participants WHERE token = ?').get(tok);
  if (!p) return null;
  if (eventId && p.event_id !== eventId) return null;
  return p;
}

function isAdmin(req, ev) {
  const tok = req.get('x-admin-token') || (req.body && req.body.adminToken);
  return tok && ev && tok === ev.admin_token;
}

const asyncH = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'server_error' });
});

// ---------------------------------------------------------------------------
// Event CRUD
// ---------------------------------------------------------------------------
app.post('/api/events', (req, res) => {
  const b = req.body || {};
  const title = (b.title || '').trim().slice(0, 120) || 'Group Run';
  let dates = Array.isArray(b.dates) ? b.dates.slice(0, 60).map(String) : [];
  const dateType = b.dateType === 'days' ? 'days' : 'dates';
  if (!dates.length) {
    return res.status(400).json({ error: 'no_dates' });
  }
  const clampMin = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1440, Math.round(n))) : d;
  };
  let timeStart = clampMin(b.timeStart, 360);
  let timeEnd = clampMin(b.timeEnd, 1200);
  if (timeEnd <= timeStart) timeEnd = Math.min(1440, timeStart + 60);
  const slot = [15, 30, 60].includes(Number(b.slotMinutes)) ? Number(b.slotMinutes) : 30;

  const id = shortId(8);
  const adminToken = token();
  db.prepare(`INSERT INTO events
    (id, admin_token, title, description, timezone, date_type, dates_json, time_start, time_end, slot_minutes, pace_unit, created_at)
    VALUES (@id,@admin,@title,@desc,@tz,@dtype,@dates,@ts,@te,@slot,@unit,@created)`
  ).run({
    id, admin: adminToken, title,
    desc: (b.description || '').slice(0, 2000),
    tz: (b.timezone || 'UTC').slice(0, 64),
    dtype: dateType,
    dates: JSON.stringify(dates),
    ts: timeStart, te: timeEnd, slot,
    unit: b.paceUnit === 'mi' ? 'mi' : 'km',
    created: now(),
  });
  res.json({ id, adminToken });
});

app.get('/api/events/:id', (req, res) => {
  const snap = buildSnapshot(req.params.id);
  if (!snap) return res.status(404).json({ error: 'not_found' });
  res.json(snap);
});

// lightweight polling endpoint — just the version number
app.get('/api/events/:id/version', (req, res) => {
  const ev = getEventRow(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  res.json({ version: ev.version });
});

// Admin: update event settings / finalize
app.patch('/api/events/:id', (req, res) => {
  const ev = getEventRow(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  if (!isAdmin(req, ev)) return res.status(403).json({ error: 'forbidden' });
  const b = req.body || {};
  const fields = {};
  if (typeof b.title === 'string') fields.title = b.title.trim().slice(0, 120);
  if (typeof b.description === 'string') fields.description = b.description.slice(0, 2000);
  if (b.finalizedSlot === null || Number.isInteger(b.finalizedSlot)) fields.finalized_slot = b.finalizedSlot;
  const keys = Object.keys(fields);
  if (keys.length) {
    db.prepare(`UPDATE events SET ${keys.map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`)
      .run({ ...fields, id: ev.id });
    bump(ev.id);
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------
app.post('/api/events/:id/participants', (req, res) => {
  const ev = getEventRow(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const name = (b.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'name_required' });

  // If a participant with this name exists, this is a "sign back in" attempt.
  const existing = db.prepare('SELECT * FROM participants WHERE event_id = ? AND name = ? COLLATE NOCASE').get(ev.id, name);
  if (existing) {
    if (existing.pin_hash) {
      if (hashPin(b.pin) !== existing.pin_hash) return res.status(401).json({ error: 'bad_pin' });
    }
    return res.json({ participant: publicParticipant(existing), token: existing.token });
  }

  const id = shortId(10);
  const tok = token();
  db.prepare(`INSERT INTO participants (id, event_id, token, name, pin_hash, color, rsvp, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, ev.id, tok, name, hashPin(b.pin), pickColor(ev.id), b.rsvp || 'yes', now());
  bump(ev.id);
  const p = db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
  res.json({ participant: publicParticipant(p), token: tok });
});

function publicParticipant(p) {
  return {
    id: p.id, name: p.name, color: p.color,
    pace_seconds: p.pace_seconds, distance_km: p.distance_km,
    rsvp: p.rsvp, locked: Boolean(p.pin_hash), created_at: p.created_at,
  };
}

// Update availability (full replace)
app.put('/api/events/:id/participants/:pid/availability', (req, res) => {
  const ev = getEventRow(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const p = authParticipant(req, ev.id);
  if (!p || p.id !== req.params.pid) return res.status(403).json({ error: 'forbidden' });

  const slots = Array.isArray(req.body.slots) ? req.body.slots.filter(Number.isInteger) : [];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM availability WHERE participant_id = ?').run(p.id);
    const ins = db.prepare('INSERT OR IGNORE INTO availability (participant_id, slot) VALUES (?,?)');
    for (const s of slots) ins.run(p.id, s);
  });
  tx();
  bump(ev.id);
  res.json({ ok: true });
});

// Update preferences (pace / distance / rsvp)
app.put('/api/events/:id/participants/:pid/prefs', (req, res) => {
  const ev = getEventRow(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const p = authParticipant(req, ev.id);
  if (!p || p.id !== req.params.pid) return res.status(403).json({ error: 'forbidden' });
  const b = req.body || {};
  const pace = b.paceSeconds == null ? null : Math.max(90, Math.min(1800, Math.round(Number(b.paceSeconds))));
  const dist = b.distanceKm == null ? null : Math.max(0, Math.min(500, Number(b.distanceKm)));
  const rsvp = ['yes', 'maybe', 'no'].includes(b.rsvp) ? b.rsvp : p.rsvp;
  db.prepare('UPDATE participants SET pace_seconds = ?, distance_km = ?, rsvp = ? WHERE id = ?')
    .run(Number.isFinite(pace) ? pace : null, Number.isFinite(dist) ? dist : null, rsvp, p.id);
  bump(ev.id);
  res.json({ ok: true });
});

app.delete('/api/events/:id/participants/:pid', (req, res) => {
  const ev = getEventRow(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const p = authParticipant(req, ev.id);
  const admin = isAdmin(req, ev);
  if (!admin && (!p || p.id !== req.params.pid)) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM participants WHERE id = ? AND event_id = ?').run(req.params.pid, ev.id);
  bump(ev.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------
app.post('/api/events/:id/locations', (req, res) => {
  const ev = getEventRow(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const p = authParticipant(req, ev.id);
  if (!p) return res.status(403).json({ error: 'forbidden' });
  const b = req.body || {};
  const name = (b.name || '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'name_required' });
  const id = shortId(8);
  db.prepare(`INSERT INTO locations (id, event_id, participant_id, name, address, lat, lng, note, created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, ev.id, p.id, name, (b.address || '').slice(0, 200),
      Number.isFinite(Number(b.lat)) ? Number(b.lat) : null,
      Number.isFinite(Number(b.lng)) ? Number(b.lng) : null,
      (b.note || '').slice(0, 300), now());
  // auto-upvote own suggestion
  db.prepare('INSERT OR IGNORE INTO location_votes (location_id, participant_id) VALUES (?,?)').run(id, p.id);
  bump(ev.id);
  res.json({ id });
});

app.post('/api/events/:id/locations/:lid/vote', (req, res) => {
  const ev = getEventRow(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const p = authParticipant(req, ev.id);
  if (!p) return res.status(403).json({ error: 'forbidden' });
  const has = db.prepare('SELECT 1 FROM location_votes WHERE location_id = ? AND participant_id = ?').get(req.params.lid, p.id);
  if (has) db.prepare('DELETE FROM location_votes WHERE location_id = ? AND participant_id = ?').run(req.params.lid, p.id);
  else db.prepare('INSERT OR IGNORE INTO location_votes (location_id, participant_id) VALUES (?,?)').run(req.params.lid, p.id);
  bump(ev.id);
  res.json({ voted: !has });
});

app.delete('/api/events/:id/locations/:lid', (req, res) => {
  const ev = getEventRow(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const p = authParticipant(req, ev.id);
  const loc = db.prepare('SELECT * FROM locations WHERE id = ? AND event_id = ?').get(req.params.lid, ev.id);
  if (!loc) return res.status(404).json({ error: 'not_found' });
  if (!isAdmin(req, ev) && (!p || p.id !== loc.participant_id)) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM locations WHERE id = ?').run(loc.id);
  bump(ev.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Routes (with Strava URL parsing)
// ---------------------------------------------------------------------------
function parseStrava(url) {
  if (!url) return {};
  const m = String(url).match(/strava\.com\/(routes|activities|segments)\/(\d+)/i);
  if (!m) return {};
  const map = { routes: 'route', activities: 'activity', segments: 'segment' };
  return { source: 'strava', strava_type: map[m[1].toLowerCase()], strava_id: m[2] };
}

app.post('/api/events/:id/routes', (req, res) => {
  const ev = getEventRow(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const p = authParticipant(req, ev.id);
  if (!p) return res.status(403).json({ error: 'forbidden' });
  const b = req.body || {};
  const name = (b.name || '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'name_required' });
  const strava = parseStrava(b.url);
  const id = shortId(8);
  db.prepare(`INSERT INTO routes
    (id, event_id, participant_id, name, source, strava_type, strava_id, url, distance_km, elevation_m, surface, note, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, ev.id, p.id, name,
      strava.source || (b.url ? 'link' : 'manual'),
      strava.strava_type || null, strava.strava_id || null,
      (b.url || '').slice(0, 500),
      Number.isFinite(Number(b.distanceKm)) ? Number(b.distanceKm) : null,
      Number.isFinite(Number(b.elevationM)) ? Number(b.elevationM) : null,
      (b.surface || '').slice(0, 20), (b.note || '').slice(0, 300), now());
  db.prepare('INSERT OR IGNORE INTO route_votes (route_id, participant_id) VALUES (?,?)').run(id, p.id);
  bump(ev.id);
  res.json({ id, strava });
});

app.post('/api/events/:id/routes/:rid/vote', (req, res) => {
  const ev = getEventRow(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const p = authParticipant(req, ev.id);
  if (!p) return res.status(403).json({ error: 'forbidden' });
  const has = db.prepare('SELECT 1 FROM route_votes WHERE route_id = ? AND participant_id = ?').get(req.params.rid, p.id);
  if (has) db.prepare('DELETE FROM route_votes WHERE route_id = ? AND participant_id = ?').run(req.params.rid, p.id);
  else db.prepare('INSERT OR IGNORE INTO route_votes (route_id, participant_id) VALUES (?,?)').run(req.params.rid, p.id);
  bump(ev.id);
  res.json({ voted: !has });
});

app.delete('/api/events/:id/routes/:rid', (req, res) => {
  const ev = getEventRow(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const p = authParticipant(req, ev.id);
  const route = db.prepare('SELECT * FROM routes WHERE id = ? AND event_id = ?').get(req.params.rid, ev.id);
  if (!route) return res.status(404).json({ error: 'not_found' });
  if (!isAdmin(req, ev) && (!p || p.id !== route.participant_id)) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM routes WHERE id = ?').run(route.id);
  bump(ev.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
app.post('/api/events/:id/comments', (req, res) => {
  const ev = getEventRow(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  const p = authParticipant(req, ev.id);
  if (!p) return res.status(403).json({ error: 'forbidden' });
  const body = (req.body.body || '').trim().slice(0, 800);
  if (!body) return res.status(400).json({ error: 'empty' });
  const id = shortId(8);
  db.prepare('INSERT INTO comments (id, event_id, participant_id, author, body, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, ev.id, p.id, p.name, body, now());
  bump(ev.id);
  res.json({ id });
});

// ---------------------------------------------------------------------------
// Geocoding proxy (OpenStreetMap Nominatim) — optional, no key required
// ---------------------------------------------------------------------------
app.get('/api/geocode', asyncH(async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ results: [] });
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'when2run/1.0 (running coordination app)' } });
  if (!r.ok) return res.json({ results: [] });
  const data = await r.json();
  res.json({
    results: data.map(d => ({
      name: d.display_name,
      lat: Number(d.lat),
      lng: Number(d.lon),
    })),
  });
}));

// ---------------------------------------------------------------------------
// Weather proxy (Open-Meteo) — no key required
// ---------------------------------------------------------------------------
app.get('/api/weather', asyncH(async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  const date = (req.query.date || '').toString(); // YYYY-MM-DD
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'bad_coords' });
  let url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=temperature_2m,precipitation_probability,weathercode,wind_speed_10m,apparent_temperature` +
    `&temperature_unit=celsius&wind_speed_unit=kmh&timezone=auto`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) url += `&start_date=${date}&end_date=${date}`;
  const r = await fetch(url);
  if (!r.ok) return res.status(502).json({ error: 'weather_unavailable' });
  res.json(await r.json());
}));

// ---------------------------------------------------------------------------
// Strava OAuth (env-gated scaffolding). Real import needs API credentials.
// ---------------------------------------------------------------------------
app.get('/api/strava/status', (req, res) => {
  res.json({ enabled: Boolean(process.env.STRAVA_CLIENT_ID) });
});

app.get('/auth/strava', (req, res) => {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) return res.status(503).send('Strava OAuth is not configured on this server. Set STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET.');
  const redirect = `${req.protocol}://${req.get('host')}/auth/strava/callback`;
  const state = (req.query.event || '').toString();
  const authUrl = `https://www.strava.com/oauth/authorize?client_id=${clientId}` +
    `&response_type=code&redirect_uri=${encodeURIComponent(redirect)}` +
    `&approval_prompt=auto&scope=read,activity:read&state=${encodeURIComponent(state)}`;
  res.redirect(authUrl);
});

app.get('/auth/strava/callback', asyncH(async (req, res) => {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.status(503).send('Strava OAuth not configured.');
  const code = req.query.code;
  if (!code) return res.redirect('/');
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code' }),
  });
  const data = await r.json();
  // Hand the token back to the SPA via URL fragment (never persisted server-side).
  const back = (req.query.state || '').toString();
  const dest = back ? `/e/${back}` : '/';
  res.redirect(`${dest}#strava_token=${encodeURIComponent(data.access_token || '')}`);
}));

// Proxy the athlete's Strava routes using their access token (client supplies it).
app.get('/api/strava/routes', asyncH(async (req, res) => {
  const auth = req.get('authorization');
  if (!auth) return res.status(401).json({ error: 'no_token' });
  const r = await fetch('https://www.strava.com/api/v3/athlete/routes?per_page=30', {
    headers: { authorization: auth },
  });
  if (!r.ok) return res.status(r.status).json({ error: 'strava_error' });
  const data = await r.json();
  res.json({
    routes: (data || []).map(rt => ({
      strava_id: String(rt.id),
      name: rt.name,
      distance_km: rt.distance ? rt.distance / 1000 : null,
      elevation_m: rt.elevation_gain || null,
      url: `https://www.strava.com/routes/${rt.id}`,
    })),
  });
}));

// ---------------------------------------------------------------------------
// SPA fallback
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`when2run running → http://localhost:${PORT}`));
}

module.exports = app;
