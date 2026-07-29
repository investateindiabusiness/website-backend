const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
    });
}

const auth = admin.auth();
const db = admin.firestore();

const COLLECTIONS = [
    // Core user data
    'users',
    // Notifications
    'notifications',
    // Helpdesk / Ticketing
    'tickets',
    'ticket_messages',
    'ticket_status_history',
    'ticket_priority_history',
    'ticket_assignments',
    'ticket_escalations',
    'ticket_reopen_history',
    'ticket_attachments',
    // Advertisements
    'advertisement_zones',
    'advertisement_campaigns',
    'advertisement_slots',
    // Coupons & Payments
    'coupons',
    'payments',
    'payment_audit',
    // Real estate
    'projects',
    'builders',
    'investors',
    'serviceProviders',
    'leads',
    'inquiries',
    // SP Outreach (messaging)
    'sp_outreach_messages',
    'sp_outreach_replies',
    // Chatbot
    'chatbot_faqs',
    // Misc
    'newsletter',
    'audit_logs'
];

const USERS = [
    { email: 'admin@investateindia.com', password: 'Admin@1234', role: 'admin', fullName: 'Admin User', isVerified: true },
    { email: 'investor@investate.com', password: '12345678', role: 'investor', fullName: 'Test Investor', isVerified: true },
    { email: 'builder@investate.com', password: '12345678', role: 'builder', fullName: 'Test Builder', companyName: 'Test Builders Pvt Ltd', isVerified: true },
    { email: "serviceprovider@gmail.com", password: "1234567", role: "serviceProvider", fullName: 'Test Service Provider', isVerified: true }
];

async function ensureCollections() {
    console.log('\n📦 Ensuring Firestore collections exist...');
    for (const collectionName of COLLECTIONS) {
        try {
            await db.collection(collectionName).limit(1).get();
            console.log(`  ✓ Collection ready: ${collectionName}`);
        } catch (error) {
            console.log(`  ! Collection check skipped for ${collectionName}: ${error.message}`);
        }
    }
}

async function createUser(userData) {
    try {
        console.log(`Creating: ${userData.email}`);
        let uid;
        try {
            const user = await auth.getUserByEmail(userData.email);
            uid = user.uid;
            console.log(`  ✓ User exists: ${uid}`);
        } catch (e) {
            const user = await auth.createUser({ email: userData.email, password: userData.password, emailVerified: true });
            uid = user.uid;
            console.log(`  ✓ Created: ${uid}`);
        }
        await db.collection('users').doc(uid).set({
            uid, email: userData.email, role: userData.role,
            fullName: userData.fullName, companyName: userData.companyName || '',
            isVerified: userData.isVerified, onboardingStatus: 'complete',
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        }, { merge: true });
        return uid;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return null;
    }
}

async function seedZones() {
    console.log('\nSeeding advertisement zones...');
    const zones = [
        { id: 'zone1', name: 'Builder Dashboard Top Banner', platform: 'Web', category: 'Real Estate', adType: 'Image', width: 728, height: 90, costPerDay: 15, status: 'active', allowedBookers: ['investor', 'serviceProvider'] },
        { id: 'zone2', name: 'Investor Dashboard Leaderboard', platform: 'Web', category: 'Real Estate', adType: 'Image', width: 728, height: 90, costPerDay: 22, status: 'active', allowedBookers: ['builder', 'serviceProvider'] },
        { id: 'zone3', name: 'Investor Project Details Sidebar', platform: 'Web', category: 'Real Estate', adType: 'Image', width: 300, height: 250, costPerDay: 18, status: 'active', allowedBookers: ['builder', 'serviceProvider'] },
        { id: 'zone4', name: 'Project Search Results Inline Ad', platform: 'Web', category: 'Real Estate', adType: 'Image', width: 728, height: 90, costPerDay: 12, status: 'active', allowedBookers: ['builder', 'serviceProvider'] },
        { id: 'zone5', name: 'Landing Page Hero Spotlight', platform: 'Web', category: 'Real Estate', adType: 'Image', width: 970, height: 250, costPerDay: 30, status: 'active', allowedBookers: ['builder', 'serviceProvider'] }
    ];

    for (const zone of zones) {
        await db.collection('advertisement_zones').doc(zone.id).set({
            ...zone,
            availableDateRange: { start: '2026-06-01', end: '2026-12-31' },
            availableTimeSlots: ['All Day'],
            defaultAd: { text: `Default ${zone.name}`, targetUrl: 'https://nrifederation.business' },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }, { merge: true });
        console.log(`  ✓ Zone ${zone.id}: ${zone.name}`);
    }
}

async function main() {
    console.log('🚀 Seeding database...\n');
    console.log('='.repeat(60));

    await ensureCollections();

    console.log('\n📋 Creating users...');
    for (const user of USERS) {
        await createUser(user);
    }

    await seedZones();

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ Database seeded successfully!\n');
    console.log('🔐 Credentials:');
    USERS.forEach(u => console.log(`  ${u.role}: ${u.email} / ${u.password}`));
    console.log('\n');
}

main().catch(console.error);
