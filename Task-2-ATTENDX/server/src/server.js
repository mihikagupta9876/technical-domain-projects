import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { Server } from 'socket.io';
import db from './db.js';

dotenv.config();

const app = express();
const http = createServer(app);

app.get('/api/events', auth, (req, res) => {
  let rows = req.user.role === 'organizer'
    ? db.prepare('SELECT * FROM events WHERE organizer_id=? ORDER BY start_time DESC').all(req.user.id)
    : db.prepare('SELECT * FROM events ORDER BY start_time DESC').all();

  const now = Date.now();
  console.log("CURRENT TIME:", new Date().toString());
console.log("EVENT TIMES:", rows.map(e => ({
  name: e.name,
  start_time: e.start_time,
  end_time: e.end_time,
  start: new Date(e.start_time).toString(),
  end: new Date(e.end_time).toString()
})));

  rows = rows.map(e => {
    const start = new Date(e.start_time).getTime();
    const end = new Date(e.end_time).getTime();

    let status = 'upcoming';

    if (now >= start && now <= end) {
      status = 'live';
    } else if (now > end) {
      status = 'ended';
    }

    return {
      ...e,
      status,
      total: db
        .prepare('SELECT COUNT(*) c FROM attendance WHERE event_id=? AND status="present"')
        .get(e.id).c
    };
  });

  res.json(rows);
});
app.post('/api/events',auth,(req,res)=>{if(req.user.role!=='organizer')return res.status(403).json({message:'Organizer only'});const {name,description,venue,latitude,longitude,radius=100,start_time,end_time}=req.body;if(!name||latitude==null||longitude==null||!start_time||!end_time)return res.status(400).json({message:'Missing event fields'});const id=randomUUID();db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,req.user.id,name,description||'',venue||'',latitude,longitude,radius,start_time,end_time,'upcoming',new Date().toISOString());res.json(db.prepare('SELECT * FROM events WHERE id=?').get(id))});
app.patch('/api/events/:id/status',auth,(req,res)=>{const e=db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);if(!e||e.organizer_id!==req.user.id)return res.status(404).json({message:'Event not found'});db.prepare('UPDATE events SET status=? WHERE id=?').run(req.body.status,e.id);res.json({ok:true})});
app.get('/api/events/:id',(req,res)=>{const e=db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);if(!e)return res.status(404).json({message:'Event not found'});const stats=db.prepare(`SELECT SUM(status='present') present,SUM(status='rejected') rejected,COUNT(*) total FROM attendance WHERE event_id=?`).get(e.id);const recent=db.prepare(`SELECT a.*,u.name,u.email FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.event_id=? ORDER BY a.marked_at DESC LIMIT 12`).all(e.id);res.json({...e,stats:{present:stats.present||0,rejected:stats.rejected||0},recent})});

app.use(cors());
app.use(express.json());

const SECRET = process.env.JWT_SECRET || 'attendx-demo-secret';

const sign = (user) =>
  jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    },
    SECRET,
    { expiresIn: '8h' }
  );

function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        message: 'Authentication required'
      });
    }

    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({
      message: 'Authentication required'
    });
  }
}

function distance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = (value) => value * Math.PI / 180;

  const x = rad(lat2 - lat1);
  const y = rad(lon2 - lon1);

  const h =
    Math.sin(x / 2) ** 2 +
    Math.cos(rad(lat1)) *
      Math.cos(rad(lat2)) *
      Math.sin(y / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

function audit(eventId, userId, action, reason = '') {
  db.prepare(
    `INSERT INTO audit_logs
    (id, event_id, user_id, action, reason, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    eventId,
    userId,
    action,
    reason,
    new Date().toISOString()
  );
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'ATTENDX API'
  });
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;

    const user = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email);

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    res.json({
      token: sign(user),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('LOGIN ERROR:', error);

    res.status(500).json({
      message: 'Login failed'
    });
  }
});

app.post('/api/auth/register', (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role = 'attendee'
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: 'Name, email and password are required'
      });
    }

    const id = randomUUID();
    const hashedPassword = bcrypt.hashSync(password, 10);
    const createdAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO users
      (id, name, email, password, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      name,
      email,
      hashedPassword,
      role,
      createdAt
    );

    const user = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id);

    res.json({
      token: sign(user),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('REGISTER ERROR:', error);

    res.status(409).json({
      message: 'Email already registered'
    });
  }
});

app.get('/api/events', auth, (req, res) => {
  try {
    let events;

    if (req.user.role === 'organizer') {
      events = db
        .prepare(
          `SELECT * FROM events
           WHERE organizer_id = ?
           ORDER BY start_time DESC`
        )
        .all(req.user.id);
    } else {
      events = db
        .prepare(
          `SELECT * FROM events
           ORDER BY start_time DESC`
        )
        .all();
    }

    const result = events.map((event) => {
      const total = db
        .prepare(
          `SELECT COUNT(*) AS c
           FROM attendance
           WHERE event_id = ?
           AND status = 'present'`
        )
        .get(event.id).c;

      return {
        ...event,
        total
      };
    });

    res.json(result);
  } catch (error) {
    console.error('GET EVENTS ERROR:', error);

    res.status(500).json({
      message: 'Could not load events'
    });
  }
});

app.post('/api/events', auth, (req, res) => {
  try {
    if (req.user.role !== 'organizer') {
      return res.status(403).json({
        message: 'Organizer only'
      });
    }

    const {
      name,
      description,
      venue,
      latitude,
      longitude,
      radius = 100,
      start_time,
      end_time
    } = req.body;

    if (
      !name ||
      latitude == null ||
      longitude == null ||
      !start_time ||
      !end_time
    ) {
      return res.status(400).json({
        message: 'Missing event fields'
      });
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO events
      (
        id,
        organizer_id,
        name,
        description,
        venue,
        latitude,
        longitude,
        radius,
        start_time,
        end_time,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.user.id,
      name,
      description || '',
      venue || '',
      latitude,
      longitude,
      radius,
      start_time,
      end_time,
      'upcoming',
      createdAt
    );

    const event = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(id);

    res.json(event);
  } catch (error) {
    console.error('CREATE EVENT ERROR:', error);

    res.status(500).json({
      message: 'Could not create event'
    });
  }
});

app.patch('/api/events/:id/status', auth, (req, res) => {
  try {
    const event = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(req.params.id);

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        message: 'Event not found'
      });
    }

    db.prepare(
      'UPDATE events SET status = ? WHERE id = ?'
    ).run(
      req.body.status,
      event.id
    );

    res.json({
      ok: true
    });
  } catch (error) {
    console.error('UPDATE EVENT STATUS ERROR:', error);

    res.status(500).json({
      message: 'Could not update event'
    });
  }
});

app.get('/api/events/:id', (req, res) => {
  try {
    const event = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(req.params.id);

    if (!event) {
      return res.status(404).json({
        message: 'Event not found'
      });
    }

    const stats = db
      .prepare(
        `SELECT
          SUM(status = 'present') AS present,
          SUM(status = 'rejected') AS rejected,
          COUNT(*) AS total
         FROM attendance
         WHERE event_id = ?`
      )
      .get(event.id);

    const recent = db
      .prepare(
        `SELECT
          a.*,
          u.name,
          u.email
         FROM attendance a
         JOIN users u ON u.id = a.user_id
         WHERE a.event_id = ?
         ORDER BY a.marked_at DESC
         LIMIT 12`
      )
      .all(event.id);

    res.json({
      ...event,
      stats: {
        present: stats.present || 0,
        rejected: stats.rejected || 0,
        total: stats.total || 0
      },
      recent
    });
  } catch (error) {
    console.error('GET EVENT ERROR:', error);

    res.status(500).json({
      message: 'Could not load event'
    });
  }
});

app.get('/api/events/:id/qr', auth, async (req, res) => {
  try {
    const event = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(req.params.id);

    if (!event) {
      return res.status(404).json({
        message: 'Event not found'
      });
    }

    const token = `${randomUUID()}.${Date.now()}`;
    const expiresAt = Date.now() + 15000;

    db.prepare(
      `INSERT INTO qr_tokens
      (id, event_id, token, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      event.id,
      token,
      expiresAt,
      new Date().toISOString()
    );

    const payload = JSON.stringify({
      eventId: event.id,
      token
    });

    const data = await QRCode.toDataURL(payload, {
      width: 520,
      margin: 2,
      errorCorrectionLevel: 'H'
    });

    res.json({
      data,
      expiresAt,
      eventId: event.id
    });
  } catch (error) {
    console.error('QR ERROR:', error);

    res.status(500).json({
      message: 'Could not generate QR code'
    });
  }
});

app.post('/api/attendance/verify', auth, (req, res) => {
  try {
    const {
      eventId,
      token,
      latitude,
      longitude
    } = req.body;

    const event = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(eventId);

    if (!event) {
      return res.status(404).json({
        message: 'Event not found'
      });
    }

    const qr = db
      .prepare(
        `SELECT * FROM qr_tokens
         WHERE event_id = ?
         AND token = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(eventId, token);

    const nowMs = Date.now();

    if (!qr || nowMs > qr.expires_at) {
      audit(
        eventId,
        req.user.id,
        'REJECTED',
        'Expired or invalid QR token'
      );

      return res.status(400).json({
        ok: false,
        reason: 'QR code expired. Please scan the live QR again.'
      });
    }

    if (
      nowMs < new Date(event.start_time).getTime() ||
      nowMs > new Date(event.end_time).getTime()
    ) {
      audit(
        eventId,
        req.user.id,
        'REJECTED',
        'Outside event time window'
      );

      return res.status(400).json({
        ok: false,
        reason: 'This event is not currently accepting attendance.'
      });
    }

    const existing = db
      .prepare(
        `SELECT * FROM attendance
         WHERE event_id = ?
         AND user_id = ?`
      )
      .get(eventId, req.user.id);

    if (existing) {
      audit(
        eventId,
        req.user.id,
        'REJECTED',
        'Duplicate attendance attempt'
      );

      return res.status(409).json({
        ok: false,
        reason: 'Attendance already marked for this event.',
        duplicate: true
      });
    }

    const calculatedDistance = distance(
      event.latitude,
      event.longitude,
      Number(latitude),
      Number(longitude)
    );

    if (calculatedDistance > event.radius) {
      audit(
        eventId,
        req.user.id,
        'REJECTED',
        `Outside radius: ${Math.round(calculatedDistance)}m`
      );

      db.prepare(
        `INSERT OR IGNORE INTO attendance
        (
          id,
          event_id,
          user_id,
          marked_at,
          latitude,
          longitude,
          distance,
          status,
          verification
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        randomUUID(),
        eventId,
        req.user.id,
        new Date().toISOString(),
        latitude,
        longitude,
        calculatedDistance,
        'rejected',
        'qr+geo'
      );

      return res.status(403).json({
        ok: false,
        reason: `You are ${Math.round(calculatedDistance)}m away. Required: within ${event.radius}m.`,
        distance: calculatedDistance
      });
    }

    const markedAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO attendance
      (
        id,
        event_id,
        user_id,
        marked_at,
        latitude,
        longitude,
        distance,
        status,
        verification
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      eventId,
      req.user.id,
      markedAt,
      latitude,
      longitude,
      calculatedDistance,
      'present',
      'qr+geo'
    );

    audit(
      eventId,
      req.user.id,
      'PRESENT',
      `Verified at ${Math.round(calculatedDistance)}m`
    );

    const user = db
      .prepare(
        'SELECT name, email FROM users WHERE id = ?'
      )
      .get(req.user.id);

    io.to(`event:${eventId}`).emit(
      'attendance:new',
      {
        name: user.name,
        email: user.email,
        marked_at: markedAt,
        distance: calculatedDistance,
        status: 'present'
      }
    );

    res.json({
      ok: true,
      message: 'Attendance verified',
      distance: calculatedDistance,
      markedAt
    });
  } catch (error) {
    console.error('ATTENDANCE ERROR:', error);

    res.status(500).json({
      message: 'Attendance verification failed'
    });
  }
});

app.get('/api/events/:id/report', auth, (req, res) => {
  try {
    const event = db
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(req.params.id);

    if (!event) {
      return res.status(404).end();
    }

    const rows = db
      .prepare(
        `SELECT
          u.name,
          u.email,
          a.status,
          a.marked_at,
          a.distance,
          a.verification
         FROM attendance a
         JOIN users u ON u.id = a.user_id
         WHERE a.event_id = ?
         ORDER BY a.marked_at`
      )
      .all(event.id);

    const registered = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM users
         WHERE role = 'attendee'`
      )
      .get().c;

    res.json({
      event,
      registered,
      rows
    });
  } catch (error) {
    console.error('REPORT ERROR:', error);

    res.status(500).json({
      message: 'Could not generate report'
    });
  }
});

app.get('/api/events/:id/audit', auth, (req, res) => {
  try {
    const logs = db
      .prepare(
        `SELECT
          l.*,
          u.name
         FROM audit_logs l
         LEFT JOIN users u ON u.id = l.user_id
         WHERE l.event_id = ?
         ORDER BY l.timestamp DESC
         LIMIT 100`
      )
      .all(req.params.id);

    res.json(logs);
  } catch (error) {
    console.error('AUDIT ERROR:', error);

    res.status(500).json({
      message: 'Could not load audit logs'
    });
  }
});

app.get('/api/dashboard', auth, (req, res) => {
  try {
    const events = db
      .prepare(
        `SELECT *
         FROM events
         WHERE organizer_id = ?
         ORDER BY start_time DESC`
      )
      .all(req.user.id);

    const present = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM attendance a
         JOIN events e ON e.id = a.event_id
         WHERE e.organizer_id = ?
         AND a.status = 'present'`
      )
      .get(req.user.id).c;

    const rejected = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM audit_logs l
         JOIN events e ON e.id = l.event_id
         WHERE e.organizer_id = ?
         AND l.action = 'REJECTED'`
      )
      .get(req.user.id).c;

    const recent = db
      .prepare(
        `SELECT
          a.*,
          u.name,
          e.name AS event_name
         FROM attendance a
         JOIN users u ON u.id = a.user_id
         JOIN events e ON e.id = a.event_id
         WHERE e.organizer_id = ?
         ORDER BY a.marked_at DESC
         LIMIT 8`
      )
      .all(req.user.id);

    res.json({
      events: events.length,
      present,
      rejected,
      recent
    });
  } catch (error) {
    console.error('DASHBOARD ERROR:', error);

    res.status(500).json({
      message: 'Dashboard database error',
      error: error.message
    });
  }
});

io.on('connection', (socket) => {
  socket.on('event:join', (eventId) => {
    socket.join(`event:${eventId}`);
  });
});

const port = process.env.PORT || 5000;

http.listen(port, () => {
  console.log(`ATTENDX API running on port ${port}`);
});
