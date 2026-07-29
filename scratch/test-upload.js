const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
    });
}

const db = admin.firestore();

async function checkUsers() {
    console.log('Checking users collection...');
    const snapshot = await db.collection('users').get();
    
    if (snapshot.empty) {
        console.log('❌ Users collection is EMPTY!');
        return;
    }

    console.log(`Found ${snapshot.size} users.`);
    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`- ${doc.id}: ${data.email} | Role: ${data.role}`);
    });
}

checkUsers().catch(console.error);
