const express = require('express');
const { z } = require('zod');
const { getDb } = require('../firebase');

const router = express.Router();
const db = getDb();
const collection = db.collection('builders');

const builderSchema = z.object({
  companyName: z.string(),
  type: z.string(),
  yearsActive: z.number(),
  registeredAddress: z.string(),
  cin: z.string(),
  gst: z.string(),
  website: z.string(),
  contactPerson: z.string(),
  email: z.string(),
  phone: z.string(),
  regions: z.array(z.string()),
  overview: z.string(),
  keyProjects: z.array(z.string()),
  logo: z.string().optional(),
  verified: z.boolean().optional(),
  rating: z.number().optional(),
  totalProjects: z.number().optional()
});

// GET /api/builders
router.get('/', async (_req, res, next) => {
  try {
    const snapshot = await collection.get();
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/builders/:id
router.get('/:id', async (req, res, next) => {
  try {
    const doc = await collection.doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Builder not found' });
    }
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    next(err);
  }
});

// POST /api/builders
router.post('/', async (req, res, next) => {
  try {
    const parseResult = builderSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        message: 'Invalid builder payload',
        errors: parseResult.error.flatten()
      });
    }
    const docRef = await collection.add({
      ...parseResult.data,
      createdAt: new Date().toISOString()
    });
    const created = await docRef.get();
    res.status(201).json({ id: created.id, ...created.data() });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/builders/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const partialSchema = builderSchema.partial();
    const parseResult = partialSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        message: 'Invalid builder payload',
        errors: parseResult.error.flatten()
      });
    }

    const docRef = collection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Builder not found' });
    }

    await docRef.update({
      ...parseResult.data,
      updatedAt: new Date().toISOString()
    });

    const updated = await docRef.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/builders/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const docRef = collection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Builder not found' });
    }
    await docRef.delete();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;

