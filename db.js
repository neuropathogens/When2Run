'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'when2run.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  admin_token   TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  timezone      TEXT DEFAULT 'UTC',
  date_type     TEXT DEFAULT 'dates',        -- 'dates' | 'days'
  dates_json    TEXT DEFAULT '[]',           -- ["2026-07-04", ...] or ["0".."6"] for days
  time_start    INTEGER DEFAULT 360,         -- minutes from midnight (6:00)
  time_end      INTEGER DEFAULT 1200,        -- 20:00
  slot_minutes  INTEGER DEFAULT 30,
  pace_unit     TEXT DEFAULT 'km',           -- 'km' | 'mi'
  finalized_slot INTEGER,                    -- chosen slot index, null until locked
  version       INTEGER DEFAULT 1,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  name         TEXT NOT NULL,
  pin_hash     TEXT,
  color        TEXT NOT NULL,
  pace_seconds INTEGER,                       -- seconds per unit (km/mi), null = unset
  distance_km  REAL,                          -- preferred distance in km
  rsvp         TEXT DEFAULT 'yes',            -- 'yes' | 'maybe' | 'no'
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS availability (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  slot           INTEGER NOT NULL,
  PRIMARY KEY (participant_id, slot)
);

CREATE TABLE IF NOT EXISTS locations (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id TEXT,
  name          TEXT NOT NULL,
  address       TEXT DEFAULT '',
  lat           REAL,
  lng           REAL,
  note          TEXT DEFAULT '',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS location_votes (
  location_id    TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  PRIMARY KEY (location_id, participant_id)
);

CREATE TABLE IF NOT EXISTS routes (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id TEXT,
  name          TEXT NOT NULL,
  source        TEXT DEFAULT 'link',          -- 'strava' | 'link' | 'manual'
  strava_type   TEXT,                          -- 'route' | 'activity' | 'segment'
  strava_id     TEXT,
  url           TEXT DEFAULT '',
  distance_km   REAL,
  elevation_m   REAL,
  surface       TEXT DEFAULT '',               -- 'road'|'trail'|'track'|'mixed'
  note          TEXT DEFAULT '',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS route_votes (
  route_id       TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  PRIMARY KEY (route_id, participant_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id TEXT,
  author        TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_part_event ON participants(event_id);
CREATE INDEX IF NOT EXISTS idx_avail_part ON availability(participant_id);
CREATE INDEX IF NOT EXISTS idx_loc_event ON locations(event_id);
CREATE INDEX IF NOT EXISTS idx_route_event ON routes(event_id);
CREATE INDEX IF NOT EXISTS idx_comment_event ON comments(event_id);
`);

// ---------- id / token helpers ----------
const ID_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz'; // no ambiguous chars
function shortId(len = 8) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}
function token() {
  return crypto.randomBytes(24).toString('base64url');
}
function hashPin(pin) {
  if (!pin) return null;
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

// ---------- palette for participant colors ----------
const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e'
];

module.exports = { db, shortId, token, hashPin, PALETTE };
