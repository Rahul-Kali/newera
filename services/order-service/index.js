require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const client = require('prom-client');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3003;

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:3001';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3002';
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3005';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3006';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3007';

async function notify(type, message) {
  try {
    await axios.post(`${NOTIFICATION_SERVICE_URL}/notify`, { type, message });
  } catch (e) {
    console.error('notify failed (non-fatal):', e.message);
  }
}

const pool = new Pool({
  host: process.env.DB_HOST || 'order-db',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'newera',
  password: process.env.DB_PASSWORD || 'newera123',
  database: process.env.DB_NAME || 'orderdb',
});

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

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      product_id VARCHAR(50) NOT NULL,
      quantity INT NOT NULL,
      status VARCHAR(30) DEFAULT 'PLACED',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'order-service' }));

app.get('/orders', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM orders ORDER BY id');
  res.json(rows);
});

// Full order saga: validate user + product -> reserve inventory -> charge payment -> persist order -> notify
// Includes compensation (releases reserved stock) if payment fails.
app.post('/orders', async (req, res) => {
  const { userId, productId, quantity, amount } = req.body;
  if (!userId || !productId || !quantity || !amount) {
    return res.status(400).json({ error: 'userId, productId, quantity, amount required' });
  }

  let reserved = false;
  try {
    const [userResp, productResp] = await Promise.all([
      axios.get(`${USER_SERVICE_URL}/users/${userId}`),
      axios.get(`${PRODUCT_SERVICE_URL}/products/${productId}`),
    ]);

    await axios.post(`${INVENTORY_SERVICE_URL}/inventory/reserve`, { productId, quantity });
    reserved = true;

    let payment;
    try {
      const payResp = await axios.post(`${PAYMENT_SERVICE_URL}/payments/charge`, { userId, amount });
      payment = payResp.data;
    } catch (payErr) {
      // Compensate: release the stock we reserved since payment failed
      await axios.post(`${INVENTORY_SERVICE_URL}/inventory/release`, { productId, quantity });
      await notify('ORDER_FAILED', `Order failed for user ${userId} - payment declined for product ${productId}`);
      return res.status(402).json({ error: 'Payment failed, order cancelled', detail: payErr.response?.data });
    }

    const { rows } = await pool.query(
      'INSERT INTO orders (user_id, product_id, quantity, status) VALUES ($1,$2,$3,$4) RETURNING *',
      [userId, productId, quantity, 'CONFIRMED']
    );

    await notify('ORDER_CONFIRMED', `Order #${rows[0].id} confirmed for user ${userId}: ${quantity} x ${productId}`);

    res.status(201).json({
      order: rows[0],
      user: userResp.data,
      product: productResp.data,
      payment,
    });
  } catch (err) {
    if (reserved) {
      await axios.post(`${INVENTORY_SERVICE_URL}/inventory/release`, { productId, quantity }).catch(() => {});
    }
    if (err.response) {
      return res.status(err.response.status).json({ error: 'Validation failed', detail: err.response.data });
    }
    res.status(500).json({ error: err.message });
  }
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`order-service listening on ${PORT}`)))
  .catch((err) => {
    console.error('DB init failed', err.message);
    process.exit(1);
  });
