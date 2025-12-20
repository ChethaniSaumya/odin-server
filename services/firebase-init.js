const admin = require('firebase-admin');
const serviceAccount = require('../firebase-service-account.json');

// Initialize Firebase only once
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log('🔥 Firebase initialized');
}

const db = admin.firestore();
const realtimeDb = admin.database();

module.exports = { admin, db, realtimeDb };