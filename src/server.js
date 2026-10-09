require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const recordRoutes = require('./routes/recordRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Log memory at startup so Render logs show baseline usage
const mem = process.memoryUsage();
console.log(
  `[startup] rss:${Math.round(mem.rss/1024/1024)}MB ` +
  `heap:${Math.round(mem.heapUsed/1024/1024)}/${Math.round(mem.heapTotal/1024/1024)}MB`
);

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/records', recordRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error.' });
});

// Prevent unhandled promise rejections from silently crashing the process
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason);
});

app.listen(PORT, () => {
  console.log(`DRT Enterprise backend running on port ${PORT}`);
});
