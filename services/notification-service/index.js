require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const client = require('prom-client');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3007;

const MONGO_URI = process.env.MONGO_URI || 'mongodb://notification-db:27017/notificationdb';
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'kalirahul176@gmail.com';

client.collectDefaultMetrics();
const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});
const notificationsSent = new client.Counter({
  name: 'notifications_sent_total',
  help: 'Total notifications sent',
  labelNames: ['channel', 'status'],
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

const notificationSchema = new mongoose.Schema({
  type: String,
  recipient: String,
  message: String,
  status: { type: String, default: 'QUEUED' },
  createdAt: { type: Date, default: Date.now },
});
const Notification = mongoose.model('Notification', notificationSchema);

// SMTP transporter - configure via env vars (e.g. Gmail App Password, SendGrid, Mailtrap, etc.)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'notification-service' }));

app.get('/notifications', async (req, res) => {
  const notes = await Notification.find().sort({ createdAt: -1 }).limit(100);
  res.json(notes);
});

// Generic notify endpoint - other services (order-service, payment-service, etc.) call this
app.post('/notify', async (req, res) => {
  const { type, recipient, message } = req.body;
  const to = recipient || ALERT_EMAIL;
  const record = await Notification.create({ type: type || 'GENERIC', recipient: to, message });

  try {
    if (process.env.SMTP_USER) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || `"NEWERA Alerts" <${process.env.SMTP_USER}>`,
        to,
        subject: `[NEWERA] ${type || 'Notification'}`,
        text: message,
      });
      record.status = 'SENT';
      notificationsSent.inc({ channel: 'email', status: 'success' });
    } else {
      // SMTP not configured - just log it, don't fail the request
      record.status = 'LOGGED_ONLY (SMTP not configured)';
      notificationsSent.inc({ channel: 'email', status: 'skipped' });
    }
    await record.save();
    res.status(201).json(record);
  } catch (err) {
    record.status = 'FAILED';
    await record.save();
    notificationsSent.inc({ channel: 'email', status: 'failure' });
    res.status(500).json({ error: err.message, record });
  }
});

mongoose
  .connect(MONGO_URI)
  .then(() => app.listen(PORT, () => console.log(`notification-service listening on ${PORT}`)))
  .catch((err) => { console.error('Mongo connection failed', err.message); process.exit(1); });
