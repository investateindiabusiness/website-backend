const express = require('express');
const { z } = require('zod');
const { getDb } = require('../firebase');
const { chatbotFaqs } = require('../data/chatbotFaqs');
const { authenticate } = require('./auth');

const router = express.Router();
const db = getDb();
const leadsCollection = db.collection('leads');
const faqsCollection = db.collection('chatbot_faqs');

const audienceAliases = {
  public: 'public',
  investor: 'investor',
  builder: 'builder',
  serviceprovider: 'serviceProvider',
  nri: 'nri',
  customer: 'customer',
};

const normalizeAudience = (value = 'public') => {
  const key = String(value || 'public').toLowerCase();
  return audienceAliases[key] || 'public';
};

const withTimeout = (promise, ms, label) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
};

const requestSchema = z.object({
  userType: z.enum(['public', 'builder', 'investor', 'serviceProvider', 'nri', 'customer']),
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().email('Valid email is required'),
  phone: z.string().trim().min(1, 'Phone number is required'),
  organization: z.string().trim().optional().default(''),
  selectedQuestion: z.string().trim().optional().default('My question is not listed'),
  message: z.string().trim().min(1, 'Please describe your question'),
  preferredContact: z.string().trim().optional().default('Any'),
});

const requireAuthenticatedAudience = (req, res, next) => {
  const requestedAudience = normalizeAudience(req.query.audience);

  if (requestedAudience === 'public') {
    return next();
  }

  return authenticate(req, res, next);
};

const enforceAudienceRole = (req, res, next) => {
  const requestedAudience = normalizeAudience(req.query.audience);

  if (requestedAudience === 'public') {
    return next();
  }

  if (requestedAudience === 'investor' && req.user?.role !== 'investor') {
    return res.status(403).json({ message: 'Investor FAQs require an investor session.' });
  }

  if (requestedAudience === 'builder' && req.user?.role !== 'builder') {
    return res.status(403).json({ message: 'Builder FAQs require a builder session.' });
  }

  if (requestedAudience === 'serviceProvider' && req.user?.role !== 'serviceProvider') {
    return res.status(403).json({ message: 'Service provider FAQs require a service provider session.' });
  }

  return next();
};

router.get('/faqs', requireAuthenticatedAudience, enforceAudienceRole, async (req, res, next) => {
  try {
    const audience = normalizeAudience(req.query.audience);

    let dbFaqs = [];
    try {
      const snapshot = await withTimeout(faqsCollection.get(), 3000, 'Chatbot FAQ lookup');
      dbFaqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (lookupErr) {
      console.warn('[chatbot] Using built-in FAQs:', lookupErr.message);
    }

    const sourceFaqs = dbFaqs.length > 0 ? dbFaqs : chatbotFaqs;

    const faqs = sourceFaqs
      .filter(faq => (faq.audience === audience || faq.audience === 'public') && faq.isActive !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(({ id, audience: itemAudience, category, question, answer, order }) => ({
        id,
        audience: itemAudience,
        category,
        question,
        answer,
        order,
      }));

    res.json({ audience, faqs });
  } catch (err) {
    next(err);
  }
});

router.post('/requests', async (req, res, next) => {
  try {
    const parseResult = requestSchema.safeParse(req.body);

    if (!parseResult.success) {
      return res.status(400).json({
        message: 'Invalid chatbot request',
        errors: parseResult.error.flatten(),
      });
    }

    const data = parseResult.data;
    const submittedAt = new Date().toISOString();
    const roleLabel = {
      public: 'Public visitor',
      builder: 'Builder',
      investor: 'Investor',
      serviceProvider: 'Service Provider',
      nri: 'NRI Investor',
      customer: 'Existing customer',
    }[data.userType];

    const lead = {
      investorName: data.name,
      investorEmail: data.email,
      investorPhone: data.phone,
      projectName: `${roleLabel} FAQ request`,
      message: data.message,
      status: 'New',
      source: 'FAQ Chatbot',
      requestType: data.userType,
      selectedQuestion: data.selectedQuestion,
      preferredContact: data.preferredContact,
      organization: data.organization,
      chatbotTranscript: [
        {
          role: 'system',
          text: `Visitor selected ${roleLabel}`,
          timestamp: submittedAt,
        },
        {
          role: 'visitor',
          text: data.selectedQuestion,
          timestamp: submittedAt,
        },
        {
          role: 'visitor',
          text: data.message,
          timestamp: submittedAt,
        },
      ],
      createdAt: submittedAt,
      updatedAt: submittedAt,
    };

    const docRef = await leadsCollection.add(lead);

    res.status(201).json({
      message: 'Your request has been submitted successfully.',
      id: docRef.id,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
