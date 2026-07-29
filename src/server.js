require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const projectsRoutes = require('./routes/projects');
const buildersRoutes = require('./routes/builders');
const investorsRoutes = require('./routes/investors');
const serviceProvidersRoutes = require('./routes/serviceProviders');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const leadsRoutes = require('./routes/leads');
const inquiriesRoutes = require('./routes/inquiries');
const newsletterRoutes = require('./routes/newsletter');
const helpdeskRoutes = require('./routes/helpdesk');
const helpdeskAdminRoutes = require('./routes/helpdeskAdmin');
const notificationsRoutes = require('./routes/notifications');
const advertisementsRoutes = require('./routes/advertisements');
const advertisementsAdminRoutes = require('./routes/advertisementsAdmin');
const paymentsRoutes = require('./routes/payments');
const uploadRoutes = require('./routes/upload');
const couponsAdminRoutes = require('./routes/couponsAdmin');
const couponsRoutes = require('./routes/coupons');
const chatbotRoutes = require('./routes/chatbot');
const spOutreachRoutes = require('./routes/sp_outreach');
const setupSwagger = require('./swagger');
const { generalLimiter } = require('./middleware/rateLimiter');

const app = express();

const port = process.env.PORT || 5001;

const allowedOrigins = [
  "http://localhost:3000",
  "https://dev.investateindia.com",
  "https://dev.investateindia.brvteck.com",
  "https://nrifederation.business"
];

if (process.env.CORS_ORIGIN) {
  const envOrigins = process.env.CORS_ORIGIN.split(',').map(o => o.trim());
  envOrigins.forEach(origin => {
    if (origin && !allowedOrigins.includes(origin)) {
      allowedOrigins.push(origin);
    }
  });
}

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json());
app.use(morgan('dev'));

// Trust proxy is required because Next.js rewrites forward traffic from a single IP (127.0.0.1).
// Without this, the rate limiter groups all traffic into one bucket and blocks everyone.
app.set('trust proxy', 1);
app.use(generalLimiter);
app.use('/uploads', express.static(require('path').join(__dirname, '../public/uploads')));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/projects', projectsRoutes);
app.use('/api/builders', buildersRoutes);
app.use('/api/investors', investorsRoutes);
app.use('/api/service-providers', serviceProvidersRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/inquiries', inquiriesRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/helpdesk', helpdeskRoutes);
app.use('/api/helpdesk', helpdeskAdminRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/advertisements', advertisementsRoutes);
app.use('/api/admin/advertisements', advertisementsAdminRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin/coupons', couponsAdminRoutes);
app.use('/api/coupons', couponsRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/sp-outreach', spOutreachRoutes);

// Setup Swagger UI Documentation
setupSwagger(app);

const http = require('http');
const socketService = require('./services/SocketService');
const advertisementCron = require('./services/AdvertisementCronService');

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
socketService.init(server, allowedOrigins);

// Start cron jobs
advertisementCron.start();

// Basic error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

server.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});
// Nodemon trigger reload to load new SMTP env configurations
