/**
 * Production seed script — run ONCE on first deploy (and safe to re-run).
 *
 * What it does:
 *   1. Creates (or updates) the admin user in Firebase Auth + Firestore
 *   2. Seeds static reference data (advertisement zones)
 *
 * What it does NOT do:
 *   ✗ Delete any existing data
 *   ✗ Create test/dummy users
 *   ✗ Reset collections
 *
 * Run with: node scripts/seed-production.js
 */

require('dotenv').config();

const { admin, getDb } = require('../src/firebase');

// ─── Admin credentials ────────────────────────────────────────────────────────
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@investateindia.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@1234';
const ADMIN_NAME     = 'Administrator';

// ─── Advertisement Zones (static reference data) ─────────────────────────────
// NOTE: If zones already exist in Firestore, this seed will skip them (no overwrite).
// Keep in sync with scripts/dev/reset-and-seed.js
const ADVERTISEMENT_ZONES = [
  { id: 'zone1', name: 'Home page Zone',                    displayType: 'Homepage Hero Leaderboard',  description: 'Bottom of main homepage hero section',          width: 970, height:  90, costPerDay: 5, status: 'active' },
  { id: 'zone2', name: 'Home page Zone 2',                  displayType: 'Homepage Mid-Page Banner',    description: 'Between sections 3-4 on the main homepage',     width: 970, height: 250, costPerDay: 5, status: 'active' },
  { id: 'zone3', name: 'Investor Page',                     displayType: 'Investor Hero Leaderboard',   description: 'Bottom of the Investor landing page hero',       width: 970, height:  90, costPerDay: 5, status: 'active' },
  { id: 'zone4', name: 'Project Search Results Inline Ad',  displayType: 'Properties Page Top Banner',  description: 'Top of the Properties listing page',            width: 970, height: 180, costPerDay: 5, status: 'active' },
  { id: 'zone5', name: 'Projects/ Properties View page',    displayType: 'Project Detail Page Banner',  description: 'Inside individual project detail pages',         width: 728, height:  90, costPerDay: 5, status: 'active' },
];

// ─────────────────────────────────────────────────────────────────────────────

async function createAdmin(db) {
  console.log('\n🔧 Step 1: Setting up admin user...');

  let uid;

  try {
    const existing = await admin.auth().getUserByEmail(ADMIN_EMAIL);
    uid = existing.uid;
    console.log(`  ✅ Auth user already exists: ${uid}`);
    await admin.auth().updateUser(uid, { password: ADMIN_PASSWORD });
    console.log(`  ✅ Password synced.`);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      const newUser = await admin.auth().createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        displayName: ADMIN_NAME,
        emailVerified: true,
      });
      uid = newUser.uid;
      console.log(`  ✅ Auth user created: ${uid}`);
    } else {
      throw err;
    }
  }

  await db.collection('users').doc(uid).set(
    {
      uid,
      email: ADMIN_EMAIL,
      fullName: ADMIN_NAME,
      role: 'admin',
      onboardingStatus: 'complete',
      createdAt: new Date().toISOString(),
    },
    { merge: true }
  );

  console.log(`  ✅ Firestore user document ready (role: admin)`);
  return uid;
}

async function seedZones(db) {
  console.log('\n📦 Step 2: Seeding advertisement zones...');

  for (const zone of ADVERTISEMENT_ZONES) {
    const ref = db.collection('advertisement_zones').doc(zone.id);
    const snap = await ref.get();

    if (snap.exists) {
      console.log(`  ⏭  Zone already exists, skipping: ${zone.id} (${zone.name})`);
      continue;
    }

    await ref.set({
      ...zone,
      availableDateRange: { start: '2026-01-01', end: '2030-12-31' },
      availableTimeSlots: ['All Day'],
      defaultAd: {
        text: `Default ${zone.name}`,
        targetUrl: 'https://nrifederation.business',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    console.log(`  ✅ Zone created: ${zone.id} — ${zone.name}`);
  }
}

async function main() {
  const db = getDb();

  console.log('\n🚀 Investate India — Production Seed');
  console.log('='.repeat(50));

  await createAdmin(db);
  await seedZones(db);

  console.log('\n' + '='.repeat(50));
  console.log('\n✅ Production seed complete!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Admin Email    : ${ADMIN_EMAIL}`);
  console.log(`  Admin Password : ${ADMIN_PASSWORD}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err.message);
  process.exit(1);
});
