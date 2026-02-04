const express = require('express');
const { z } = require('zod');
const { getDb } = require('../firebase');

const router = express.Router();
const db = getDb();
const collection = db.collection('projects');

const projectSchema = z.object({
  title: z.string(),
  builderName: z.string(),
  builderId: z.string().optional(),
  city: z.string(),
  location: z.string(),
  stage: z.string(),
  priceRange: z.string(),
  expectedYield: z.string(),
  configurations: z.string(),
  area: z.string(),
  possession: z.string(),
  reraNumber: z.string(),
  type: z.string().optional(),
  totalUnits: z.number().optional(),
  availableUnits: z.number().optional(),
  amenities: z.array(z.string()).optional(),
  highlights: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
  brochure: z.string().optional(),
  featured: z.boolean().optional(),
  views: z.number().optional(),
  inquiries: z.number().optional()
});

// GET /api/projects
router.get('/', async (_req, res, next) => {
  try {
    const snapshot = await collection.get();
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id
router.get('/:id', async (req, res, next) => {
  try {
    const doc = await collection.doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Project not found' });
    }
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects
router.post('/', async (req, res, next) => {
  try {
    const parseResult = projectSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        message: 'Invalid project payload',
        errors: parseResult.error.flatten()
      });
    }
    const docRef = await collection.add({
      ...parseResult.data,
      views: parseResult.data.views ?? 0,
      inquiries: parseResult.data.inquiries ?? 0,
      createdAt: new Date().toISOString()
    });
    const created = await docRef.get();
    res.status(201).json({ id: created.id, ...created.data() });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/projects/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const partialSchema = projectSchema.partial();
    const parseResult = partialSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        message: 'Invalid project payload',
        errors: parseResult.error.flatten()
      });
    }

    const docRef = collection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Project not found' });
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

// DELETE /api/projects/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const docRef = collection.doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Project not found' });
    }
    await docRef.delete();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;

