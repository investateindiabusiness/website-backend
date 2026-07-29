const { getDb } = require('../firebase');
const crypto = require('crypto');

class PaymentRepository {
  constructor() {
    this.db = getDb();
    this.collectionName = 'payments';
  }

  /**
   * Helper to generate a unique human-readable payment number.
   * Format: PAY-YYYYMMDD-HEX6
   */
  _generatePaymentNumber() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;
    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `PAY-${dateStr}-${randomHex}`;
  }

  /**
   * Create a new payment record in Firestore.
   */
  async create(paymentData) {
    const now = new Date().toISOString();
    const paymentNumber = this._generatePaymentNumber();
    
    const paymentRecord = {
      ...paymentData,
      paymentNumber,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    };

    // If ID is provided, use it (e.g. from service check), otherwise auto-generate
    const docRef = paymentData.id 
      ? this.db.collection(this.collectionName).doc(paymentData.id)
      : this.db.collection(this.collectionName).doc();
      
    // Remove temporary ID field from record if present
    delete paymentRecord.id;

    await docRef.set(paymentRecord);
    return { id: docRef.id, ...paymentRecord };
  }

  /**
   * Retrieve a payment by document ID.
   */
  async getById(id) {
    const doc = await this.db.collection(this.collectionName).doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  /**
   * Retrieve a payment by Stripe Payment Intent ID.
   */
  async getByPaymentIntentId(stripePaymentIntentId) {
    if (!stripePaymentIntentId) return null;
    const snapshot = await this.db.collection(this.collectionName)
      .where('stripePaymentIntentId', '==', stripePaymentIntentId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  /**
   * Update a payment record.
   */
  async update(id, updateData) {
    const now = new Date().toISOString();
    const docRef = this.db.collection(this.collectionName).doc(id);
    
    const cleanUpdate = {
      ...updateData,
      updatedAt: now
    };

    if (updateData.status === 'SUCCEEDED' && !updateData.completedAt) {
      cleanUpdate.completedAt = now;
    }

    await docRef.update(cleanUpdate);
    
    // Fetch and return the updated document
    const updatedDoc = await docRef.get();
    return { id: updatedDoc.id, ...updatedDoc.data() };
  }

  /**
   * Retrieve payments by referenceType and referenceId.
   */
  async getByReference(referenceType, referenceId) {
    const snapshot = await this.db.collection(this.collectionName)
      .where('referenceType', '==', referenceType)
      .where('referenceId', '==', referenceId)
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async find(filters = {}) {
    const {
      userId,
      status,
      paymentPurpose,
      referenceType,
      referenceId,
      startDate,
      endDate,
      limit = 10,
      page = 1,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = filters;

    try {
      let query = this.db.collection(this.collectionName);

      // Apply exact matches
      if (userId) query = query.where('userId', '==', userId);
      if (status) query = query.where('status', '==', status);
      if (paymentPurpose) query = query.where('paymentPurpose', '==', paymentPurpose);
      if (referenceType) query = query.where('referenceType', '==', referenceType);
      if (referenceId) query = query.where('referenceId', '==', referenceId);

      // Apply date range
      if (startDate) query = query.where('createdAt', '>=', startDate);
      if (endDate) query = query.where('createdAt', '<=', endDate);

      // Order
      query = query.orderBy(sortBy, sortOrder);

      // Count total records for metadata (Firestore count() is lightweight and efficient)
      const countSnapshot = await query.count().get();
      const totalRecords = countSnapshot.data().count;

      // Apply offset and limit pagination
      const offset = (page - 1) * limit;
      if (offset > 0) {
        query = query.offset(offset);
      }
      query = query.limit(limit);

      const snapshot = await query.get();
      const records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      return {
        data: records,
        pagination: {
          total: totalRecords,
          limit,
          page,
          pages: Math.ceil(totalRecords / limit)
        }
      };
    } catch (err) {
      // Catch missing index error and do in-memory search as fallback
      if (err.message && err.message.includes('FAILED_PRECONDITION')) {
        console.warn(`[PaymentRepository] Firestore composite index not found. Falling back to in-memory filter and sort.`);
        
        // Fetch all documents in the collection
        const snapshot = await this.db.collection(this.collectionName).get();
        let allRecords = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Apply filters in-memory
        if (userId) allRecords = allRecords.filter(r => r.userId === userId);
        if (status) allRecords = allRecords.filter(r => r.status === status);
        if (paymentPurpose) allRecords = allRecords.filter(r => r.paymentPurpose === paymentPurpose);
        if (referenceType) allRecords = allRecords.filter(r => r.referenceType === referenceType);
        if (referenceId) allRecords = allRecords.filter(r => r.referenceId === referenceId);

        if (startDate) allRecords = allRecords.filter(r => r.createdAt >= startDate);
        if (endDate) allRecords = allRecords.filter(r => r.createdAt <= endDate);

        // Sort in-memory
        allRecords.sort((a, b) => {
          const valA = a[sortBy] || '';
          const valB = b[sortBy] || '';
          if (sortOrder === 'asc') {
            return valA > valB ? 1 : valA < valB ? -1 : 0;
          } else {
            return valA < valB ? 1 : valA > valB ? -1 : 0;
          }
        });

        const totalRecords = allRecords.length;
        const offset = (page - 1) * limit;
        const paginatedRecords = allRecords.slice(offset, offset + limit);

        return {
          data: paginatedRecords,
          pagination: {
            total: totalRecords,
            limit,
            page,
            pages: Math.ceil(totalRecords / limit)
          }
        };
      }
      
      // Re-throw if it was another error
      throw err;
    }
  }
}

module.exports = new PaymentRepository();
