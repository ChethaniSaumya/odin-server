const admin = require('firebase-admin');

if (!admin.apps.length) {
  // Decode Base64 private key
  let privateKey;
  try {
    // First try Base64 decode (for production)
    const decoded = Buffer.from(process.env.FIREBASE_PRIVATE_KEY, 'base64').toString('utf8');
    // Check if it looks like a valid key
    if (decoded.includes('-----BEGIN PRIVATE KEY-----')) {
      privateKey = decoded;
    } else {
      // Not base64, use as-is with newline replacement
      privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    }
  } catch (e) {
    // Fallback: use as-is with newline replacement
    privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  }

  console.log('🔑 Private key starts with:', privateKey.substring(0, 30));
  
  admin.initializeApp({
    credential: admin.credential.cert({
      type: process.env.FIREBASE_TYPE,
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: privateKey,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: process.env.FIREBASE_AUTH_URI,
      token_uri: process.env.FIREBASE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
      client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
      universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
  console.log('🔥 Firebase initialized successfully');
}

const db = admin.firestore();
const realtimeDb = admin.database();

module.exports = { admin, db, realtimeDb };
