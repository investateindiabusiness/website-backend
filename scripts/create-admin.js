/**
 * One-time script to create an admin user in Firebase Auth + Firestore.
 * Run with: node scripts/create-admin.js
 */

require('dotenv').config();

const { admin, getDb } = require('../src/firebase');

const ADMIN_EMAIL = [EMAIL_ADDRESS]
const ADMIN_PASSWORD = '[PASSWORD]';
const ADMIN_NAME = 'Administrator';

async function createAdmin() {
  const db = getDb();

  console.log(`\n🔧 Setting up admin user: ${ADMIN_EMAIL}\n`);

  let uid;

  // Step 1: Create or get the user in Firebase Auth
  try {
    const existing = await admin.auth().getUserByEmail(ADMIN_EMAIL);
    uid = existing.uid;
    console.log(`✅ Firebase Auth user already exists: ${uid}`);

    // Update password to ensure it's correct
    await admin.auth().updateUser(uid, { password: ADMIN_PASSWORD });
    console.log(`✅ Password updated successfully.`);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      const newUser = await admin.auth().createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        displayName: ADMIN_NAME,
        emailVerified: true,
      });
      uid = newUser.uid;
      console.log(`✅ Firebase Auth user created: ${uid}`);
    } else {
      throw err;
    }
  }

  // Step 2: Set/overwrite the Firestore document with role: 'admin'
  await db.collection('users').doc(uid).set({
    uid,
    email: ADMIN_EMAIL,
    fullName: ADMIN_NAME,
    role: 'admin',
    createdAt: new Date().toISOString(),
    onboardingStatus: 'complete',
  }, { merge: true });

  console.log(`✅ Firestore document set with role: 'admin'\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Email    : ${ADMIN_EMAIL}`);
  console.log(`  Password : ${ADMIN_PASSWORD}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n✅ Admin user is ready. You can now log in.\n');

  process.exit(0);
}

createAdmin().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
