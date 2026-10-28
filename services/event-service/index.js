require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const { body, param, validationResult } = require('express-validator');
const pool = require('./db');
const redis = require('./redis');
const { requireAuth, requireAdmin } = require('./auth');

const app = express();
app.use(helmet());
app.use(express.json());

const CACHE_KEY = 'events:all';
const CACHE_SECONDS = 60;

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// LIST EVENTS (cached in Redis)
app.get('/api/v1/events', async (req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(JSON.parse(cached));
    }
    const result = await pool.query('SELECT * FROM events ORDER BY event_date');
    await redis.setEx(CACHE_KEY, CACHE_SECONDS, JSON.stringify(result.rows));
    res.set('X-Cache', 'MISS');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET ONE EVENT
app.get('/api/v1/events/:id', param('id').isInt(), validate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Event not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// CREATE EVENT (admin only)
app.post('/api/v1/events',
  requireAuth, requireAdmin,
  body('title').trim().notEmpty(),
  body('venue').trim().notEmpty(),
  body('event_date').isISO8601(),
  body('price').isFloat({ min: 0 }),
  body('total_seats').isInt({ min: 1 }),
  validate,
  async (req, res) => {
    const { title, venue, event_date, price, total_seats } = req.body;
    try {
      const result = await pool.query(
        `INSERT INTO events (title, venue, event_date, price, total_seats, available_seats)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
        [title, venue, event_date, price, total_seats]
      );
      await redis.del(CACHE_KEY); // clear cache so the list refreshes
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// RESERVE SEATS (called by the Booking Service)
app.patch('/api/v1/events/:id/reserve',
  requireAuth,
  param('id').isInt(),
  body('quantity').isInt({ min: 1, max: 10 }),
  validate,
  async (req, res) => {
    try {
      // One atomic statement: prevents overselling even with many requests at once
      const result = await pool.query(
        `UPDATE events SET available_seats = available_seats - $1
         WHERE id = $2 AND available_seats >= $1
         RETURNING id, title, available_seats, price`,
        [req.body.quantity, req.params.id]
      );
      if (result.rowCount === 0) {
        return res.status(409).json({ error: 'Not enough seats or event not found' });
      }
      await redis.del(CACHE_KEY);
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// RELEASE SEATS (used by the Booking Service to undo a reservation)
app.patch('/api/v1/events/:id/release',
  requireAuth,
  param('id').isInt(),
  body('quantity').isInt({ min: 1, max: 10 }),
  validate,
  async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE events SET available_seats = LEAST(available_seats + $1, total_seats)
         WHERE id = $2 RETURNING id, available_seats`,
        [req.body.quantity, req.params.id]
      );
      await redis.del(CACHE_KEY);
      res.json(result.rows[0] || {});
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);
// API v2: same data in a richer shape. v1 keeps working unchanged.
app.get('/api/v2/events', async (req, res) => {
  try {
    let rows;
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      rows = JSON.parse(cached);
      res.set('X-Cache', 'HIT');
    } else {
      rows = (await pool.query('SELECT * FROM events ORDER BY event_date')).rows;
      await redis.setEx(CACHE_KEY, CACHE_SECONDS, JSON.stringify(rows));
      res.set('X-Cache', 'MISS');
    }
    res.json({
      version: 2,
      count: rows.length,
      events: rows.map((e) => ({
        id: e.id,
        title: e.title,
        venue: e.venue,
        date: e.event_date,
        price: Number(e.price),
        seats: {
          total: e.total_seats,
          available: e.available_seats,
          sold: e.total_seats - e.available_seats
        },
        sold_out: e.available_seats === 0
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(process.env.PORT || 3002, () =>
  console.log('Event service running on port', process.env.PORT || 3002));