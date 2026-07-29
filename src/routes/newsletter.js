const express = require('express');
const { z } = require('zod');
const { getDb } = require('../firebase');

const router = express.Router();
const db = getDb();
const collection = db.collection('newsletter');

// Simple Zod schema for email validation
const emailSchema = z.object({
  email: z.string().email("Please provide a valid email address.")
});

// POST: Add email to newsletter/waitlist
router.post('/', async (req, res, next) => {
  try {
    const parseResult = emailSchema.safeParse(req.body);
    
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid email format." });
    }

    const email = parseResult.data.email;

    // Check if email already exists to prevent duplicates
    const existingEmail = await collection.where('email', '==', email).get();
    if (!existingEmail.empty) {
      return res.status(400).json({ message: "This email is already on our waitlist!" });
    }

    // Save to database
    await collection.add({
      email: email,
      subscribedAt: new Date().toISOString(),
      status: 'Active'
    });

    res.status(201).json({ message: "Successfully joined the network!" });
  } catch (err) {
    next(err);
  }
});

// GET: Fetch all subscribers (for your future Admin Panel)
router.get('/', async (req, res, next) => {
  try {
    const snapshot = await collection.orderBy('subscribedAt', 'desc').get();
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// PATCH: Update subscriber status (Active / Deactive)
router.patch('/:id', async (req, res, next) => {
  try {
    const { status } = req.body;
    const docRef = collection.doc(req.params.id);
    const doc = await docRef.get();
    
    if (!doc.exists) return res.status(404).json({ message: 'Subscriber not found' });

    await docRef.update({
      status,
      updatedAt: new Date().toISOString()
    });

    res.json({ message: 'Subscriber status updated successfully' });
  } catch (err) {
    next(err);
  }
});

// DELETE: Remove subscriber
router.delete('/:id', async (req, res, next) => {
  try {
    await collection.doc(req.params.id).delete();
    res.status(200).json({ message: 'Subscriber deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;