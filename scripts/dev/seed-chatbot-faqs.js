~require('dotenv').config();

const { getDb } = require('../src/firebase');
const { chatbotFaqs } = require('../src/data/chatbotFaqs');

async function seedChatbotFaqs() {
  const db = getDb();
  const batch = db.batch();
  const now = new Date().toISOString();

  chatbotFaqs.forEach((faq) => {
    const docRef = db.collection('chatbot_faqs').doc(faq.id);
    batch.set(docRef, {
      ...faq,
      updatedAt: now,
      createdAt: faq.createdAt || now,
    }, { merge: true });
  });

  await batch.commit();
  console.log(`Seeded ${chatbotFaqs.length} chatbot FAQs into chatbot_faqs.`);
}

seedChatbotFaqs()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed to seed chatbot FAQs:', error);
    process.exit(1);
  });
