require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const client = require('prom-client');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3002;

const MONGO_URI = process.env.MONGO_URI || 'mongodb://product-db:27017/productdb';

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

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  stock: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});
const Product = mongoose.model('Product', productSchema);

async function seed() {
  const count = await Product.countDocuments();
  if (count === 0) {
    await Product.insertMany([
      { name: 'NewEra T-Shirt', price: 499, stock: 100 },
      { name: 'NewEra Cap', price: 299, stock: 200 },
      { name: 'NewEra Hoodie', price: 1299, stock: 50 },
    ]);
  }
}

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'product-service' }));

app.get('/products', async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

app.get('/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (e) {
    res.status(400).json({ error: 'Invalid id' });
  }
});

app.post('/products', async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

mongoose
  .connect(MONGO_URI)
  .then(seed)
  .then(() => app.listen(PORT, () => console.log(`product-service listening on ${PORT}`)))
  .catch((err) => {
    console.error('Mongo connection failed', err.message);
    process.exit(1);
  });
