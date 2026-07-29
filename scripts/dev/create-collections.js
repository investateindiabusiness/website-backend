const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
    });
}

const db = admin.firestore();

const COLLECTIONS = [
    'notifications',
    'tickets',
    'ticket_messages',
    'ticket_status_history',
    'ticket_priority_history',
    'ticket_assignments',
    'ticket_escalations',
    'ticket_reopen_history',
    'ticket_attachments',
    'advertisement_zones',
    'advertisement_campaigns',
    'advertisement_slots',
    'coupons',
    'payments',
    'payment_audit',
    'projects',
    'builders',
    'investors',
    'serviceProviders',
    'leads',
    'inquiries',
    'newsletter',
    'audit_logs'
];

async function main() {
    console.log('🚀 Initializing collections in Firestore...\n');
    const batch = db.batch();
    const now = new Date().toISOString();

    for (const collection of COLLECTIONS) {
        // We add a placeholder document to force the collection to appear in the Firebase Console
        const docRef = db.collection(collection).doc('_placeholder');
        batch.set(docRef, {
            _description: `Placeholder to initialize the ${collection} collection.`,
            createdAt: now
        });
        console.log(`  ✓ Added placeholder to collection: ${collection}`);
    }

    await batch.commit();
    console.log('\n✅ All collections have been created and are now visible in your Firebase Console!');
}

main().catch(console.error);
