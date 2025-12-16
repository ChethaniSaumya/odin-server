// test-mint.js - Save this in your project root and run: node test-mint.js

const { 
    Client, 
    PrivateKey, 
    TokenMintTransaction, 
    TransferTransaction,
    AccountBalanceQuery,
    TokenInfoQuery,
    TokenAssociateTransaction
} = require("@hashgraph/sdk");
require("dotenv").config();

async function testMint() {
    console.log("\n🔍 MINT DIAGNOSTIC TEST");
    console.log("=".repeat(50));

    // 1. Check environment variables
    console.log("\n📋 Environment Check:");
    console.log("   OPERATOR_ID:", process.env.OPERATOR_ID || "❌ MISSING");
    console.log("   TOKEN_ID:", process.env.TOKEN_ID || "❌ MISSING");
    console.log("   SUPPLY_KEY:", process.env.SUPPLY_KEY ? "✅ Set" : "❌ MISSING");
    console.log("   OPERATOR_KEY:", process.env.OPERATOR_KEY ? "✅ Set" : "❌ MISSING");

    if (!process.env.OPERATOR_ID || !process.env.TOKEN_ID || !process.env.SUPPLY_KEY) {
        console.log("\n❌ Missing required environment variables!");
        return;
    }

    // 2. Setup client
    const client = Client.forTestnet();
    
    // Parse operator key (handle different formats)
    let operatorKey;
    const opKey = process.env.OPERATOR_KEY.trim();
    
    try {
        if (opKey.startsWith("0x") || (opKey.length === 64 && !opKey.startsWith("302"))) {
            operatorKey = PrivateKey.fromStringECDSA(opKey.replace("0x", ""));
            console.log("   Operator Key Format: ECDSA");
        } else if (opKey.startsWith("302")) {
            operatorKey = PrivateKey.fromStringDer(opKey);
            console.log("   Operator Key Format: DER");
        } else {
            operatorKey = PrivateKey.fromStringED25519(opKey);
            console.log("   Operator Key Format: ED25519");
        }
    } catch (e) {
        console.log("❌ Failed to parse OPERATOR_KEY:", e.message);
        return;
    }

    client.setOperator(process.env.OPERATOR_ID, operatorKey);

    // 3. Check account balance
    console.log("\n💰 Account Balance Check:");
    try {
        const balance = await new AccountBalanceQuery()
            .setAccountId(process.env.OPERATOR_ID)
            .execute(client);
        
        console.log("   HBAR Balance:", balance.hbars.toString());
        
        if (balance.hbars.toTinybars() < 1000000000) { // Less than 10 HBAR
            console.log("   ⚠️  Balance seems low for minting");
        } else {
            console.log("   ✅ Balance looks good");
        }
    } catch (e) {
        console.log("   ❌ Failed to check balance:", e.message);
    }

    // 4. Check token info
    console.log("\n🎨 Token Info Check:");
    try {
        const tokenInfo = await new TokenInfoQuery()
            .setTokenId(process.env.TOKEN_ID)
            .execute(client);
        
        console.log("   Token ID:", tokenInfo.tokenId.toString());
        console.log("   Name:", tokenInfo.name);
        console.log("   Symbol:", tokenInfo.symbol);
        console.log("   Treasury:", tokenInfo.treasuryAccountId.toString());
        console.log("   Total Supply:", tokenInfo.totalSupply.toString());
        console.log("   Supply Key:", tokenInfo.supplyKey ? "✅ Configured" : "❌ NOT SET");
        
        if (!tokenInfo.supplyKey) {
            console.log("\n❌ CRITICAL: Token has no supply key! Cannot mint.");
            console.log("   You need to redeploy the token with a supply key.");
            return;
        }
    } catch (e) {
        console.log("   ❌ Failed to get token info:", e.message);
        return;
    }

    // 5. Parse and verify supply key
    console.log("\n🔑 Supply Key Check:");
    let supplyKey;
    try {
        const supKey = process.env.SUPPLY_KEY.trim();
        
        if (supKey.startsWith("302")) {
            supplyKey = PrivateKey.fromStringDer(supKey);
            console.log("   Supply Key Format: DER ✅");
        } else if (supKey.startsWith("0x") || supKey.length === 64) {
            supplyKey = PrivateKey.fromStringECDSA(supKey.replace("0x", ""));
            console.log("   Supply Key Format: ECDSA ✅");
        } else {
            supplyKey = PrivateKey.fromStringED25519(supKey);
            console.log("   Supply Key Format: ED25519 ✅");
        }
        
        console.log("   Public Key:", supplyKey.publicKey.toString().substring(0, 40) + "...");
    } catch (e) {
        console.log("   ❌ Failed to parse SUPPLY_KEY:", e.message);
        return;
    }

    // 6. Try to mint
    console.log("\n🎨 Attempting Test Mint:");
    try {
        const testMetadata = "https://min.theninerealms.world/metadata/1.json";
        const metadataBytes = Buffer.from(testMetadata, 'utf8');
        
        console.log("   Metadata URL:", testMetadata);
        console.log("   Creating mint transaction...");

        const mintTx = new TokenMintTransaction()
            .setTokenId(process.env.TOKEN_ID)
            .addMetadata(metadataBytes)
            .freezeWith(client);

        console.log("   Signing with supply key...");
        const signedTx = await mintTx.sign(supplyKey);

        console.log("   Executing transaction...");
        const txResponse = await signedTx.execute(client);

        console.log("   Waiting for receipt...");
        const receipt = await txResponse.getReceipt(client);

        console.log("\n✅ MINT SUCCESSFUL!");
        console.log("   Status:", receipt.status.toString());
        console.log("   Serial Number:", receipt.serials[0]?.toNumber() || "N/A");
        console.log("   Transaction ID:", txResponse.transactionId.toString());

    } catch (e) {
        console.log("\n❌ MINT FAILED!");
        console.log("   Error:", e.message);
        
        if (e.message.includes("INSUFFICIENT_PAYER_BALANCE")) {
            console.log("\n💡 FIX: Your operator account needs more HBAR");
            console.log("   Get testnet HBAR from: https://portal.hedera.com/faucet");
        }
        
        if (e.message.includes("INVALID_SIGNATURE")) {
            console.log("\n💡 FIX: The SUPPLY_KEY in .env doesn't match the token's supply key");
            console.log("   You may need to redeploy the token");
        }
        
        if (e.message.includes("TOKEN_HAS_NO_SUPPLY_KEY")) {
            console.log("\n💡 FIX: Token was created without a supply key");
            console.log("   You must redeploy with: node scripts/deploy-ultimate.js");
        }
    }

    client.close();
    console.log("\n" + "=".repeat(50));
}

testMint();