require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const client = require('prom-client');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3004;
const JWT_SECRET = process.env.JWT_SECRET || 'newera-super-secret-change-me';

const pool = new Pool({
  host: process.env.DB_HOST || 'auth-db',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'newera',
  password: process.env.DB_PASSWORD || 'newera123',
  database: process.env.DB_NAME || 'authdb',
});

client.collectDefaultMetrics();
const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});
const authFailures = new client.Counter({
  name: 'auth_failures_total',
  help: 'Total failed login attempts',
});
app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequestCounter.inc({ method: req.method, route: req.path, status: res.statusCode });
  });
  next();
});
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credentials (
      id SERIAL PRIMARY KEY,
      email VARCHAR(150) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(30) DEFAULT 'customer',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'auth-service' }));

app.post('/auth/register', async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO credentials (email, password_hash, role) VALUES ($1,$2,$3) RETURNING id, email, role',
      [email, hash, role || 'customer']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM credentials WHERE email=$1', [email]);
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
    authFailures.inc();
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ sub: rows[0].id, email: rows[0].email, role: rows[0].role }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ token });
});

app.get('/auth/verify', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, ...decoded });
  } catch (e) {
    res.status(401).json({ valid: false, error: 'Invalid or expired token' });
  }
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`auth-service listening on ${PORT}`)))
  .catch((err) => { console.error('DB init failed', err.message); process.exit(1); });
