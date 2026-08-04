require('dotenv').config();
const { getDb } = require('./src/firebase');
const { sendMail } = require('./src/utils/emailHelper');

async function testFirebase() {
  console.log('Testing Firebase connection...');
  try {
    const db = getDb();
    await db.collection('test_ping').doc('ping').set({ ts: Date.now() });
    console.log('Firebase connection successful!');
  } catch (err) {
    console.error('Firebase connection failed:', err);
  }
}

async function testEmail() {
  console.log('Testing Email connection via emailHelper...');
  try {
    await sendMail('test@example.com', 'Test Email', 'This is a test');
    console.log('Email sent successfully!');
  } catch (err) {
    console.error('Email sending failed:', err);
  }
}

async function run() {
  await testFirebase();
  await testEmail();
  process.exit(0);
}

run();
