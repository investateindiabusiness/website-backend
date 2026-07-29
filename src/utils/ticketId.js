const { getDb, admin } = require('../firebase');

/**
 * Auto-generates a ticket ID in the format: TKT-YYYYMMDD-NNNN
 * Uses a Firestore counter document for atomic sequential numbering.
 * Resets the counter daily.
 */
const generateTicketId = async () => {
  const db = getDb();
  const today = new Date();
  const datePart = today.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD

  const counterRef = db.collection('_system').doc(`ticket_counter_${datePart}`);

  const newCount = await db.runTransaction(async (transaction) => {
    const counterDoc = await transaction.get(counterRef);

    let count = 1;
    if (counterDoc.exists) {
      count = (counterDoc.data().count || 0) + 1;
    }

    transaction.set(counterRef, { count, date: datePart }, { merge: true });
    return count;
  });

  const sequence = String(newCount).padStart(4, '0');
  return `TKT-${datePart}-${sequence}`;
};

module.exports = { generateTicketId };
