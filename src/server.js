require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const projectsRoutes = require('./routes/projects');
const buildersRoutes = require('./routes/builders');
const authRoutes = require('./routes/auth');
const { authenticate } = require('./routes/auth');

const app = express();

const port = process.env.PORT || 5000;
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';

app.use(
  cors({
    origin: corsOrigin,
    credentials: true
  })
);
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/projects', projectsRoutes);
app.use('/api/builders', buildersRoutes);
app.use('/api/auth', authRoutes);

// Basic error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});

