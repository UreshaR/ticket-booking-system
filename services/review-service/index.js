require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const { MongoClient } = require('mongodb');
const { body, query, validationResult } = require('express-validator');
const { requireAuth } = require('./auth');

const app = express();
app.use(helmet());
app.use(express.json());

let reviews = null; // the MongoDB collection, set once connected

// Keep trying until MongoDB is reachable
async function initDb() {
  while (!reviews) {
    try {
      const client = new MongoClient(process.env.MONGO_URL);
      await client.connect();
      const col = client.db('reviewsdb').collection('reviews');
      // One review per user per event
      await col.createIndex({ event_id: 1, user_id: 1 }, { unique: true });
      reviews = col;
      console.log('MongoDB connected');
    } catch (err) {
      console.error('MongoDB not ready, retrying in 3s:', err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ADD A REVIEW (logged-in users)
app.post('/api/v1/reviews',
  requireAuth,
  body('event_id').isInt({ min: 1 }),
  body('rating').isInt({ min: 1, max: 5 }),
  body('comment').optional().isString().trim().isLength({ max: 500 }),
  validate,
  async (req, res) => {
    if (!reviews) return res.status(503).json({ error: 'Database not ready' });
    const doc = {
      event_id: Number(req.body.event_id),
      user_id: req.user.id,
      rating: Number(req.body.rating),
      comment: req.body.comment || '',
      created_at: new Date()
    };
    try {
      await reviews.insertOne(doc);
      res.status(201).json({
        event_id: doc.event_id,
        rating: doc.rating,
        comment: doc.comment,
        created_at: doc.created_at
      });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'You already reviewed this event' });
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// LIST REVIEWS FOR AN EVENT (public): /api/v1/reviews?event_id=1
app.get('/api/v1/reviews',
  query('event_id').isInt({ min: 1 }),
  validate,
  async (req, res) => {
    if (!reviews) return res.status(503).json({ error: 'Database not ready' });
    const eventId = Number(req.query.event_id);
    try {
      const [stats] = await reviews.aggregate([
        { $match: { event_id: eventId } },
        { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } }
      ]).toArray();

      const list = await reviews
        .find({ event_id: eventId }, { projection: { _id: 0, user_id: 0 } })
        .sort({ created_at: -1 })
        .limit(50)
        .toArray();

      res.json({
        event_id: eventId,
        count: stats ? stats.count : 0,
        average: stats ? Math.round(stats.average * 10) / 10 : null,
        reviews: list
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

initDb();
app.listen(process.env.PORT || 3005, () =>
  console.log('Review service running on port', process.env.PORT || 3005));