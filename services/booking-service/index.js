require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');
const pool = require('./db');
const { requireAuth } = require('./auth');
const rabbit = require('./rabbit');

const app = express();
app.use(helmet());
app.use(express.json());

const EVENT_URL = process.env.EVENT_SERVICE_URL;

async function callEventService(method, path, token, body) {
  return fetch(`${EVENT_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000) // don't wait forever
  });
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// CREATE BOOKING
app.post('/api/v1/bookings',
  requireAuth,
  body('event_id').isInt({ min: 1 }),
  body('quantity').isInt({ min: 1, max: 10 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { event_id, quantity } = req.body;

    // 1. SYNCHRONOUS: ask the Event Service to reserve seats
    let event;
    try {
      const r = await callEventService('PATCH', `/api/v1/events/${event_id}/reserve`, req.token, { quantity });
      if (r.status === 409) return res.status(409).json({ error: 'Not enough seats or event not found' });
      if (!r.ok) return res.status(502).json({ error: 'Event service error' });
      event = await r.json();
    } catch (err) {
      console.error('Event service unreachable:', err.message);
      return res.status(503).json({ error: 'Event service unavailable, try again later' });
    }

    // 2. Save the booking
    let booking;
    try {
      const total = Number(event.price) * quantity;
      const result = await pool.query(
        `INSERT INTO bookings (user_id, event_id, event_title, quantity, total_price)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.user.id, event_id, event.title, quantity, total]
      );
      booking = result.rows[0];
    } catch (err) {
      console.error('DB error, releasing seats:', err.message);
      // Compensation: give the seats back so they aren't lost
      callEventService('PATCH', `/api/v1/events/${event_id}/release`, req.token, { quantity }).catch(() => {});
      return res.status(500).json({ error: 'Could not save booking' });
    }

    // 3. ASYNCHRONOUS: publish a message (booking is already saved, so don't fail if this fails)
    try {
      rabbit.publishBookingCreated({
        booking_id: booking.id,
        user_id: req.user.id,
        email: req.user.email,
        event_title: event.title,
        quantity,
        total_price: booking.total_price
      });
    } catch (err) {
      console.error('Could not publish message:', err.message);
    }

    res.status(201).json(booking);
  }
);

// MY BOOKINGS
app.get('/api/v1/bookings/my', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM bookings WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

rabbit.connect();
app.listen(process.env.PORT || 3003, () =>
  console.log('Booking service running on port', process.env.PORT || 3003));