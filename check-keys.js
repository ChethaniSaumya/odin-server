const { PrivateKey } = require("@hashgraph/sdk");
require("dotenv").config();

console.log("🔍 Checking if your keys match on-chain keys...\n");

// Your SUPPLY_KEY from .env
const supplyKeyPrivate = PrivateKey.fromStringDer(process.env.SUPPLY_KEY);
const supplyKeyPublic = supplyKeyPrivate.publicKey.toStringRaw();

console.log("SUPPLY_KEY from your .env:");
console.log("   Private (DER):", process.env.SUPPLY_KEY.substring(0, 30) + "...");
console.log("   Public (hex): ", supplyKeyPublic);
console.log("   On-chain:     ", "8a532021cb3cc9d4dcd63043aec65b8c21fb305d9081a70cfe98029059578e2c");
console.log("   Match:", supplyKeyPublic === "8a532021cb3cc9d4dcd63043aec65b8c21fb305d9081a70cfe98029059578e2c" ? "✅ YES" : "❌ NO");

console.log("");

// Your ADMIN_KEY from .env
const adminKeyPrivate = PrivateKey.fromStringDer(process.env.ADMIN_KEY);
const adminKeyPublic = adminKeyPrivate.publicKey.toStringRaw();

console.log("ADMIN_KEY from your .env:");
console.log("   Private (DER):", process.env.ADMIN_KEY.substring(0, 30) + "...");
console.log("   Public (hex): ", adminKeyPublic);

console.log("");

// Your PAUSE_KEY from .env
const pauseKeyPrivate = PrivateKey.fromStringDer(process.env.PAUSE_KEY);
const pauseKeyPublic = pauseKeyPrivate.publicKey.toStringRaw();

console.log("PAUSE_KEY from your .env:");
console.log("   Private (DER):", process.env.PAUSE_KEY.substring(0, 30) + "...");
console.log("   Public (hex): ", pauseKeyPublic);
console.log("   On-chain:     ", "6eaf3cffda6c49e5b8d833ab04b0131f2a78f4a33e7784b07413e4d407f01518");
console.log("   Match:", pauseKeyPublic === "6eaf3cffda6c49e5b8d833ab04b0131f2a78f4a33e7784b07413e4d407f01518" ? "✅ YES" : "❌ NO");