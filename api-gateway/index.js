const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const client = require('prom-client');

const app = express();
const PORT = process.env.PORT || 8084;

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:3001';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3002';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order-service:3003';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3004';
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3005';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3006';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3007';

client.collectDefaultMetrics();
const httpRequestCounter = new client.Counter({
  name: 'gateway_requests_total',
  help: 'Total requests through gateway',
  labelNames: ['route', 'status'],
});
app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequestCounter.inc({ route: req.path.split('/')[1] || 'root', status: res.statusCode });
  });
  next();
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'api-gateway' }));

app.use('/api/users', createProxyMiddleware({ target: USER_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/api/users': '/users' } }));
app.use('/api/products', createProxyMiddleware({ target: PRODUCT_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/api/products': '/products' } }));
app.use('/api/orders', createProxyMiddleware({ target: ORDER_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/api/orders': '/orders' } }));
app.use('/api/auth', createProxyMiddleware({ target: AUTH_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/api/auth': '/auth' } }));
app.use('/api/inventory', createProxyMiddleware({ target: INVENTORY_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/api/inventory': '/inventory' } }));
app.use('/api/payments', createProxyMiddleware({ target: PAYMENT_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/api/payments': '/payments' } }));
app.use('/api/notifications', createProxyMiddleware({ target: NOTIFICATION_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/api/notifications': '/notifications' } }));

app.listen(PORT, () => console.log(`api-gateway listening on ${PORT}`));
