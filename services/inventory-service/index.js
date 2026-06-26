require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const client = require('prom-client');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3005;

const pool = new Pool({
  host: process.env.DB_HOST || 'inventory-db',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'newera',
  password: process.env.DB_PASSWORD || 'newera123',
  database: process.env.DB_NAME || 'inventorydb',
});

client.collectDefaultMetrics();
const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});
const lowStockGauge = new client.Gauge({
  name: 'inventory_low_stock_items',
  help: 'Number of SKUs below the low-stock threshold',
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
    CREATE TABLE IF NOT EXISTS stock (
      product_id VARCHAR(50) PRIMARY KEY,
      available INT NOT NULL DEFAULT 0,
      reserved INT NOT NULL DEFAULT 0,
      low_stock_threshold INT NOT NULL DEFAULT 10
    );
  `);
}

async function refreshLowStockGauge() {
  const { rows } = await pool.query('SELECT COUNT(*) FROM stock WHERE available < low_stock_threshold');
  lowStockGauge.set(parseInt(rows[0].count, 10));
}
setInterval(refreshLowStockGauge, 15000);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'inventory-service' }));

app.get('/inventory/:productId', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM stock WHERE product_id=$1', [req.params.productId]);
  if (!rows.length) return res.status(404).json({ error: 'No stock record for this product' });
  res.json(rows[0]);
});

// Create or top up stock for a product
app.post('/inventory', async (req, res) => {
  const { productId, available, lowStockThreshold } = req.body;
  if (!productId || available == null) return res.status(400).json({ error: 'productId and available required' });
  const { rows } = await pool.query(
    `INSERT INTO stock (product_id, available, low_stock_threshold) VALUES ($1,$2,$3)
     ON CONFLICT (product_id) DO UPDATE SET available = stock.available + $2
     RETURNING *`,
    [productId, available, lowStockThreshold || 10]
  );
  await refreshLowStockGauge();
  res.status(201).json(rows[0]);
});

// Reserve stock for an order (atomic check-and-decrement)
app.post('/inventory/reserve', async (req, res) => {
  const { productId, quantity } = req.body;
  if (!productId || !quantity) return res.status(400).json({ error: 'productId and quantity required' });
  const result = await pool.query(
    `UPDATE stock SET available = available - $2, reserved = reserved + $2
     WHERE product_id=$1 AND available >= $2 RETURNING *`,
    [productId, quantity]
  );
  if (!result.rows.length) return res.status(409).json({ error: 'Insufficient stock' });
  await refreshLowStockGauge();
  res.json(result.rows[0]);
});

app.post('/inventory/release', async (req, res) => {
  const { productId, quantity } = req.body;
  const result = await pool.query(
    `UPDATE stock SET available = available + $2, reserved = reserved - $2
     WHERE product_id=$1 RETURNING *`,
    [productId, quantity]
  );
  res.json(result.rows[0] || {});
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`inventory-service listening on ${PORT}`)))
  .catch((err) => { console.error('DB init failed', err.message); process.exit(1); });
