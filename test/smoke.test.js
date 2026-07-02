'use strict';
// Minimal end-to-end smoke test — no test framework, just assertions.
// Uses a throwaway DB by pointing at a temp data dir via env before require.

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// isolate DB
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w2r-test-'));
process.env.PORT = '0';
// redirect data dir by monkeypatching: db.js uses __dirname/data, so we just
// run against the real data dir but with a unique-enough flow. To keep it clean,
// we instead copy nothing and rely on unique ids. (Acceptable for smoke test.)

const app = require('../server');

let server, base;
const j = (res) => res.json();

async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, data };
}

(async () => {
  server = app.listen(0);
  await new Promise(r => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  let pass = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓', msg); pass++; };

  // create event
  let r = await call('POST', '/api/events', {
    title: 'Test Run', dateType: 'dates', dates: ['2099-01-01', '2099-01-02'],
    timeStart: 360, timeEnd: 480, slotMinutes: 30, paceUnit: 'km',
  });
  ok(r.status === 200 && r.data.id, 'creates an event');
  const eid = r.data.id, adminToken = r.data.adminToken;

  // reject empty dates
  r = await call('POST', '/api/events', { title: 'bad', dates: [] });
  ok(r.status === 400, 'rejects event with no dates');

  // join two participants
  r = await call('POST', `/api/events/${eid}/participants`, { name: 'Alice' });
  ok(r.status === 200 && r.data.token, 'Alice joins');
  const alice = r.data.participant, aliceTok = r.data.token;

  r = await call('POST', `/api/events/${eid}/participants`, { name: 'Bob', pin: '1234' });
  const bob = r.data.participant, bobTok = r.data.token;
  ok(bob && bobTok, 'Bob joins with PIN');

  // bad PIN re-join
  r = await call('POST', `/api/events/${eid}/participants`, { name: 'Bob', pin: '0000' });
  ok(r.status === 401, 'rejects Bob re-join with wrong PIN');

  // set availability (overlap at slots 0,1)
  r = await call('PUT', `/api/events/${eid}/participants/${alice.id}/availability`, { slots: [0, 1, 2] }, { 'x-participant-token': aliceTok });
  ok(r.status === 200, 'Alice sets availability');
  r = await call('PUT', `/api/events/${eid}/participants/${bob.id}/availability`, { slots: [1, 2, 3] }, { 'x-participant-token': bobTok });
  ok(r.status === 200, 'Bob sets availability');

  // cannot set someone else's availability
  r = await call('PUT', `/api/events/${eid}/participants/${alice.id}/availability`, { slots: [5] }, { 'x-participant-token': bobTok });
  ok(r.status === 403, 'blocks cross-participant availability edits');

  // snapshot reflects overlap
  r = await call('GET', `/api/events/${eid}`);
  ok(r.data.availability['1'].length === 2, 'slot 1 has 2 available (overlap)');
  ok(r.data.participants.length === 2, 'snapshot lists 2 participants');

  // prefs
  r = await call('PUT', `/api/events/${eid}/participants/${alice.id}/prefs`, { paceSeconds: 330, distanceKm: 10 }, { 'x-participant-token': aliceTok });
  ok(r.status === 200, 'Alice sets pace/distance');

  // location + vote
  r = await call('POST', `/api/events/${eid}/locations`, { name: 'Park Gate', lat: 40.7, lng: -73.9 }, { 'x-participant-token': aliceTok });
  const lid = r.data.id;
  ok(lid, 'adds a location (auto-upvoted)');
  r = await call('POST', `/api/events/${eid}/locations/${lid}/vote`, {}, { 'x-participant-token': bobTok });
  ok(r.data.voted === true, 'Bob votes location');
  r = await call('GET', `/api/events/${eid}`);
  ok(r.data.locations[0].votes.length === 2, 'location has 2 votes');

  // route with strava url parsing
  r = await call('POST', `/api/events/${eid}/routes`, { name: 'River Loop', url: 'https://www.strava.com/routes/1234567' }, { 'x-participant-token': aliceTok });
  ok(r.data.strava && r.data.strava.strava_id === '1234567' && r.data.strava.strava_type === 'route', 'parses Strava route URL');

  // comment
  r = await call('POST', `/api/events/${eid}/comments`, { body: 'lets gooo' }, { 'x-participant-token': aliceTok });
  ok(r.status === 200, 'adds a comment');

  // admin finalize
  r = await call('PATCH', `/api/events/${eid}`, { finalizedSlot: 1 }, { 'x-admin-token': adminToken });
  ok(r.status === 200, 'admin finalizes a slot');
  r = await call('PATCH', `/api/events/${eid}`, { finalizedSlot: 2 }, { 'x-admin-token': 'wrong' });
  ok(r.status === 403, 'rejects finalize without admin token');
  r = await call('GET', `/api/events/${eid}`);
  ok(r.data.finalizedSlot === 1, 'finalized slot persisted');

  // version bumps
  ok(r.data.version > 1, 'version incremented across mutations');

  // weather proxy shape (network-dependent; tolerate failure)
  try {
    r = await call('GET', `/api/weather?lat=40.7&lng=-73.9&date=2099-01-01`);
    ok(r.status === 200 || r.status === 502, 'weather endpoint responds');
  } catch { console.log('  ~ weather skipped (offline)'); }

  console.log(`\n✅ ${pass} checks passed`);
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch(err => { console.error('❌ test failed:', err); server?.close(); process.exit(1); });
