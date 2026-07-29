const express = require('express');
const { getDb } = require('../firebase');

const router = express.Router();
const db = getDb();
const collection = db.collection('leads');

// GET all leads (Admin)
router.get('/', async (req, res, next) => {
  try {
    const snapshot = await collection.orderBy('createdAt', 'desc').get();
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// PATCH update lead (Status, Notes, Details)
router.patch('/:id', async (req, res, next) => {
  try {
    const docRef = collection.doc(req.params.id);
    const doc = await docRef.get();
    
    if (!doc.exists) return res.status(404).json({ message: 'Lead not found' });

    await docRef.update({
      ...req.body,
      updatedAt: new Date().toISOString()
    });

    res.json({ message: 'Lead updated successfully' });
  } catch (err) {
    next(err);
  }
});

// DELETE lead
router.delete('/:id', async (req, res, next) => {
  try {
    await collection.doc(req.params.id).delete();
    res.status(200).json({ message: 'Lead deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;