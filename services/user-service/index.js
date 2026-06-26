require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const client = require('prom-client');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

const pool = new Pool({
  host: process.env.DB_HOST || 'user-db',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'newera',
  password: process.env.DB_PASSWORD || 'newera123',
  database: process.env.DB_NAME || 'userdb',
});

// ---- Prometheus metrics setup ----
client.collectDefaultMetrics();
const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
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

// ---- DB init ----
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  const { rows } = await pool.query('SELECT COUNT(*) FROM users');
  if (parseInt(rows[0].count, 10) === 0) {
    await pool.query(`INSERT INTO users (name, email) VALUES
      ('Alice Sharma','alice@newera.com'),
      ('Ravi Kumar','ravi@newera.com'),
      ('Meera Iyer','meera@newera.com')`);
  }
}

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'user-service' }));

app.get('/users', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
  res.json(rows);
});

app.get('/users/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

app.post('/users', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (name, email) VALUES ($1,$2) RETURNING *',
      [name, email]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`user-service listening on ${PORT}`)))
  .catch((err) => {
    console.error('DB init failed, retrying in 5s...', err.message);
    setTimeout(() => process.exit(1), 5000);
  });
