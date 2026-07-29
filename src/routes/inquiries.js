const express = require('express');
const { z } = require('zod');
const { getDb } = require('../firebase');

const router = express.Router();
const db = getDb();
const collection = db.collection('inquiries');

// Validation Schema
const inquirySchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(1, "Phone is required"),
  subject: z.string().optional(),
  message: z.string().min(1, "Message is required"),
});

// POST: Submit a new contact inquiry
router.post('/', async (req, res, next) => {
  try {
    const parseResult = inquirySchema.safeParse(req.body);
    
    if (!parseResult.success) {
      return res.status(400).json({ 
        message: "Invalid data", 
        errors: parseResult.error.flatten() 
      });
    }

    const newInquiry = {
      ...parseResult.data,
      status: 'New', // So the admin knows it hasn't been read yet
      createdAt: new Date().toISOString()
    };

    const docRef = await collection.add(newInquiry);
    res.status(201).json({ message: "Inquiry submitted successfully", id: docRef.id });
    
  } catch (err) {
    next(err);
  }
});

// GET all inquiries (Admin)
router.get('/', async (req, res, next) => {
  try {
    const snapshot = await collection.orderBy('createdAt', 'desc').get();
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// PATCH update inquiry (Status & Admin Notes)
router.patch('/:id', async (req, res, next) => {
  try {
    const docRef = collection.doc(req.params.id);
    const doc = await docRef.get();
    
    if (!doc.exists) return res.status(404).json({ message: 'Inquiry not found' });

    await docRef.update({
      ...req.body,
      updatedAt: new Date().toISOString()
    });

    res.json({ message: 'Inquiry updated successfully' });
  } catch (err) {
    next(err);
  }
});

// DELETE inquiry
router.delete('/:id', async (req, res, next) => {
  try {
    await collection.doc(req.params.id).delete();
    res.status(200).json({ message: 'Inquiry deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;