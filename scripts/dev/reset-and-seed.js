/**
 * reset-and-seed.js
 *
 * DESTRUCTIVE: Wipes ALL Firestore collections + Firebase Auth users,
 * then re-creates users and advertisement_zones.
 *
 * Run: node scripts/reset-and-seed.js
 */

require('dotenv').config();
const { admin, getDb } = require('../src/firebase');

const ADMIN_PASSWORD = 'Admin@1234';
const USER_PASSWORD = '12345678';

const USERS = [
  { email: 'admin@investateindia.com', password: ADMIN_PASSWORD, role: 'admin', fullName: 'Administrator' },
  { email: 'investor@investateindia.com', password: USER_PASSWORD, role: 'investor', fullName: 'Test Investor' },
  { email: 'builder@investateindia.com', password: USER_PASSWORD, role: 'builder', fullName: 'Test Builder', companyName: 'Test Builders Pvt Ltd' },
  { email: 'serviceprovider@investateindia.com', password: USER_PASSWORD, role: 'serviceProvider', fullName: 'Test Service Provider' },
];

// Zone names & descriptions match exactly what is shown in the UI screenshot
const ZONES = [
  { id: 'zone1', name: 'Home page Zone',                    displayType: 'Homepage Hero Leaderboard',  description: 'Bottom of main homepage hero section',          width: 970, height:  90, costPerDay: 5, status: 'active' },
  { id: 'zone2', name: 'Home page Zone 2',                  displayType: 'Homepage Mid-Page Banner',    description: 'Between sections 3-4 on the main homepage',     width: 970, height: 250, costPerDay: 5, status: 'active' },
  { id: 'zone3', name: 'Investor Page',                     displayType: 'Investor Hero Leaderboard',   description: 'Bottom of the Investor landing page hero',       width: 970, height:  90, costPerDay: 5, status: 'active' },
  { id: 'zone4', name: 'Project Search Results Inline Ad',  displayType: 'Properties Page Top Banner',  description: 'Top of the Properties listing page',            width: 970, height: 180, costPerDay: 5, status: 'active' },
  { id: 'zone5', name: 'Projects/ Properties View page',    displayType: 'Project Detail Page Banner',  description: 'Inside individual project detail pages',         width: 728, height:  90, costPerDay: 5, status: 'active' },
];

const ALL_COLLECTIONS = [
  'users', 'notifications', 'tickets', 'ticket_messages', 'ticket_status_history',
  'ticket_priority_history', 'ticket_assignments', 'ticket_escalations',
  'ticket_reopen_history', 'ticket_attachments', 'advertisement_zones',
  'advertisement_campaigns', 'advertisement_slots', 'coupons', 'payments',
  'payment_audit', 'projects', 'builders', 'investors', 'serviceProviders',
  'leads', 'inquiries', 'sp_outreach_messages', 'sp_outreach_replies',
  'chatbot_faqs', 'newsletter', 'audit_logs',
];

const db = getDb();
const auth = admin.auth();
const now = () => new Date().toISOString();

/* ── Helpers ─────────────────────────────────────────────────── */

async function clearCollection(name) {
  let deleted = 0;
  while (true) {
    const snap = await db.collection(name).limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
  }
  if (deleted) console.log(`    cleared ${deleted} docs from: ${name}`);
}

async function deleteAllAuthUsers() {
  console.log('\nDeleting all Firebase Auth users...');
  let pageToken;
  let total = 0;
  do {
    const result = await auth.listUsers(1000, pageToken);
    if (result.users.length) {
      const uids = result.users.map(u => u.uid);
      await auth.deleteUsers(uids);
      total += uids.length;
      console.log(`    removed ${uids.length} auth users`);
    }
    pageToken = result.pageToken;
  } while (pageToken);
  console.log(`  Total auth users removed: ${total}`);
}

async function upsertUser(userData) {
  let uid;
  try {
    const existing = await auth.getUserByEmail(userData.email);
    uid = existing.uid;
    await auth.updateUser(uid, { password: userData.password, emailVerified: true });
    console.log(`    updated auth: ${userData.email}`);
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      const created = await auth.createUser({
        email: userData.email, password: userData.password,
        displayName: userData.fullName, emailVerified: true,
      });
      uid = created.uid;
      console.log(`    created auth: ${userData.email}  [${uid}]`);
    } else throw e;
  }
  await db.collection('users').doc(uid).set({
    uid, email: userData.email, fullName: userData.fullName, role: userData.role,
    companyName: userData.companyName || '', isVerified: true,
    onboardingStatus: 'complete', createdAt: now(), updatedAt: now(),
  }, { merge: true });
  console.log(`    firestore doc set (role: ${userData.role})`);
}

async function seedZones() {
  console.log('\nSeeding advertisement zones...');
  for (const zone of ZONES) {
    await db.collection('advertisement_zones').doc(zone.id).set({
      ...zone,
      allowedBookers: ['investor', 'builder', 'serviceProvider'],
      platform: 'Web',
      adType: 'Image',
      availableDateRange: { start: '2026-01-01', end: '2027-12-31' },
      availableTimeSlots: ['All Day'],
      defaultAd: { text: `Default ${zone.name}`, targetUrl: 'https://nrifederation.business' },
      createdAt: now(),
      updatedAt: now(),
    });
    console.log(`    ${zone.id}: ${zone.name}  (Rs.${zone.costPerDay}/day)`);
  }
}

/* ── Main ────────────────────────────────────────────────────── */

async function main() {
  console.log('\n' + '='.repeat(50));
  console.log('  RESET + SEED  -  Investate India');
  console.log('='.repeat(50));

  await deleteAllAuthUsers();

  console.log('\nClearing all Firestore collections...');
  for (const col of ALL_COLLECTIONS) {
    await clearCollection(col);
  }

  console.log('\nCreating users...');
  for (const user of USERS) {
    await upsertUser(user);
  }

  await seedZones();

  console.log('\n' + '='.repeat(50));
  console.log('  DONE!');
  console.log('='.repeat(50));
  console.log('\nCredentials:\n');
  USERS.forEach(u =>
    console.log(`  [${u.role.padEnd(15)}]  ${u.email.padEnd(42)}  ${u.password}`)
  );
  console.log('\nZones:\n');
  ZONES.forEach(z =>
    console.log(`  ${z.id}: ${z.name.padEnd(40)}  Rs.${z.costPerDay}/day`)
  );
  console.log('');
  process.exit(0);
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
