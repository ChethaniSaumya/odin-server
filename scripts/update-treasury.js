const { Client, PrivateKey, TokenUpdateTransaction } = require("@hashgraph/sdk");
require("dotenv").config();

async function updateTreasury() {
    const NEW_TREASURY = "0.0.10096557";
    const NEW_TREASURY_PRIVATE_KEY = "64608a9eabbb0eb2fde2abf30d3619b116610ed730fde4a8ffc7000caff28619";
    
    console.log("🔄 Updating on-chain treasury to:", NEW_TREASURY);
    
    const client = Client.forMainnet();
    
    // Parse operator key
    let operatorKey;
    const opKeyStr = process.env.OPERATOR_KEY.trim();
    if (opKeyStr.startsWith("302")) {
        operatorKey = PrivateKey.fromStringDer(opKeyStr);
    } else if (opKeyStr.startsWith("0x") || opKeyStr.length === 64) {
        operatorKey = PrivateKey.fromStringECDSA(opKeyStr.replace("0x", ""));
    } else {
        operatorKey = PrivateKey.fromStringED25519(opKeyStr);
    }
    
    client.setOperator(process.env.OPERATOR_ID, operatorKey);
    
    // Parse admin key
    let adminKey;
    const adminKeyStr = process.env.ADMIN_KEY.trim();
    if (adminKeyStr.startsWith("302")) {
        adminKey = PrivateKey.fromStringDer(adminKeyStr);
    } else if (adminKeyStr.startsWith("0x") || adminKeyStr.length === 64) {
        adminKey = PrivateKey.fromStringECDSA(adminKeyStr.replace("0x", ""));
    } else {
        adminKey = PrivateKey.fromStringED25519(adminKeyStr);
    }
    
    // Parse new treasury key
    let newTreasuryKey;
    const newKeyStr = NEW_TREASURY_PRIVATE_KEY.trim();
    if (newKeyStr.startsWith("302")) {
        newTreasuryKey = PrivateKey.fromStringDer(newKeyStr);
    } else if (newKeyStr.startsWith("0x") || newKeyStr.length === 64) {
        newTreasuryKey = PrivateKey.fromStringECDSA(newKeyStr.replace("0x", ""));
    } else {
        newTreasuryKey = PrivateKey.fromStringED25519(newKeyStr);
    }
    
    console.log("✅ All keys parsed successfully");
    console.log("📝 Token ID:", process.env.TOKEN_ID);
    
    const transaction = await new TokenUpdateTransaction()
        .setTokenId(process.env.TOKEN_ID)
        .setTreasuryAccountId(NEW_TREASURY)
        .freezeWith(client);
    
    // Sign with both keys
    let signedTx = await transaction.sign(adminKey);
    signedTx = await signedTx.sign(newTreasuryKey);
    
    console.log("✅ Transaction signed, executing...");
    
    const response = await signedTx.execute(client);
    const receipt = await response.getReceipt(client);
    
    console.log("✅ Treasury updated! Status:", receipt.status.toString());
    console.log("🔗 Transaction ID:", response.transactionId.toString());
}

updateTreasury().catch(console.error);