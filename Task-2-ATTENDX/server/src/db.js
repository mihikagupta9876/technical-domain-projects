import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const db = new DatabaseSync('attendx.db');

db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'attendee',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events(
  id TEXT PRIMARY KEY,
  organizer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  venue TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  radius INTEGER NOT NULL DEFAULT 100,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qr_tokens(
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance(
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  marked_at TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  distance REAL,
  status TEXT NOT NULL,
  verification TEXT NOT NULL,
  UNIQUE(event_id,user_id)
);

CREATE TABLE IF NOT EXISTS audit_logs(
  id TEXT PRIMARY KEY,
  event_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  reason TEXT,
  timestamp TEXT NOT NULL
);
`);

const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;

if (!count) {
  const now = new Date().toISOString();
  const pass = bcrypt.hashSync('admin123',10);
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('org-demo','Mihika Gupta','organizer@attendx.local',pass,'organizer',now); const p2 = bcrypt.hashSync('student123',10);
 db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(
  'student-demo',
  'Demo Student',
  'student@attendx.local',
  p2,
  'attendee',
  now
);
  const id = randomUUID();

  const start = new Date(
    Date.now() - 60 * 60 * 1000
  ).toISOString();

  const end = new Date(
    Date.now() + 2 * 60 * 60 * 1000
  ).toISOString();

  db.prepare(
    'INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    id,
    'org-demo',
    'Tech Club Launch Night',
    'A secure, QR-powered club orientation with live verification.',
    'SRM University',
    12.8236,
    80.0452,
    250,
    start,
    end,
    'live',
    now
  );
}

export default db;
