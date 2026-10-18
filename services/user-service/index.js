require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('./db');

const app = express();
app.use(helmet());
app.use(express.json());

// Health check (used later by Docker/Kubernetes)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// REGISTER
app.post('/api/v1/auth/register',
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, password } = req.body;
    try {
      const hash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
        [name, email, hash]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// LOGIN
app.post('/api/v1/auth/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    try {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      const user = result.rows[0];
      const ok = user && await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );
      res.json({ token });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

app.listen(process.env.PORT || 3001, () =>
  console.log('User service running on port', process.env.PORT || 3001));

pool.query('SELECT NOW()')
  .then(r => console.log('DB connected:', r.rows[0]))
  .catch(e => console.error('DB error:', e.message));