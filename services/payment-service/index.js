require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const client = require('prom-client');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3006;

const pool = new Pool({
  host: process.env.DB_HOST || 'payment-db',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'newera',
  password: process.env.DB_PASSWORD || 'newera123',
  database: process.env.DB_NAME || 'paymentdb',
});

client.collectDefaultMetrics();
const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});
const paymentFailures = new client.Counter({
  name: 'payment_failures_total',
  help: 'Total failed payment attempts',
});
const paymentAmountHistogram = new client.Histogram({
  name: 'payment_amount',
  help: 'Distribution of successful payment amounts',
  buckets: [100, 500, 1000, 2500, 5000, 10000],
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
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      order_id INT,
      user_id INT NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      status VARCHAR(30) DEFAULT 'PENDING',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'payment-service' }));

// Mock charge: simulates a payment gateway call. ~5% random failure rate to mimic real life.
app.post('/payments/charge', async (req, res) => {
  const { userId, orderId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: 'userId and amount required' });

  const success = Math.random() > 0.05;
  const status = success ? 'SUCCESS' : 'FAILED';

  const { rows } = await pool.query(
    'INSERT INTO payments (order_id, user_id, amount, status) VALUES ($1,$2,$3,$4) RETURNING *',
    [orderId || null, userId, amount, status]
  );

  if (!success) {
    paymentFailures.inc();
    return res.status(402).json({ error: 'Payment declined', payment: rows[0] });
  }
  paymentAmountHistogram.observe(Number(amount));
  res.status(201).json(rows[0]);
});

app.get('/payments/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM payments WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Payment not found' });
  res.json(rows[0]);
});

app.get('/payments', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM payments ORDER BY id DESC LIMIT 100');
  res.json(rows);
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`payment-service listening on ${PORT}`)))
  .catch((err) => { console.error('DB init failed', err.message); process.exit(1); });
