const { Client, PrivateKey, TokenCreateTransaction, TokenType, Hbar } = require("@hashgraph/sdk");
require("dotenv").config();

async function deployNFT() {
    console.log("🔫 BULLETPROOF NFT DEPLOYMENT");
    console.log("========================================\n");

    // 1. VALIDATE ENVIRONMENT
    if (!process.env.OPERATOR_ID || !process.env.OPERATOR_KEY) {
        console.log("❌ MISSING: OPERATOR_ID or OPERATOR_KEY in .env");
        console.log("💡 Make sure your .env file has:");
        console.log("   OPERATOR_ID=0.0.XXXXXX");
        console.log("   OPERATOR_KEY=your_private_key_here");
        process.exit(1);
    }

    console.log("✅ Environment check passed");
    console.log("📝 Account:", process.env.OPERATOR_ID);

    // 2. FIXED CLIENT CONFIGURATION
    const client = Client.forTestnet();

    try {
        // TRY ALL KEY FORMATS - ONE WILL WORK
        let operatorKey;
        const keyString = process.env.OPERATOR_KEY.trim();

        console.log("🔑 Testing key formats...");

        // Method 1: Standard DER
        try {
            operatorKey = PrivateKey.fromString(keyString);
            console.log("✅ Standard DER format");
        } catch (e1) {
            // Method 2: ED25519
            try {
                operatorKey = PrivateKey.fromStringED25519(keyString);
                console.log("✅ ED25519 format");
            } catch (e2) {
                // Method 3: ECDSA  
                try {
                    operatorKey = PrivateKey.fromStringECDSA(keyString);
                    console.log("✅ ECDSA format");
                } catch (e3) {
                    // Method 4: Raw bytes as last resort
                    try {
                        const keyBytes = Buffer.from(keyString, 'hex');
                        operatorKey = PrivateKey.fromBytes(keyBytes);
                        console.log("✅ Raw bytes format");
                    } catch (e4) {
                        console.log("❌ ALL KEY FORMATS FAILED");
                        console.log("💡 Your private key is invalid");
                        process.exit(1);
                    }
                }
            }
        }

        client.setOperator(process.env.OPERATOR_ID, operatorKey);
        console.log("✅ Client configured successfully");

        // 3. GENERATE UPGRADE KEYS
        console.log("\n🔑 Generating upgrade keys...");
        const adminKey = PrivateKey.generate();
        const supplyKey = PrivateKey.generate();
        const pauseKey = PrivateKey.generate();
        const feeScheduleKey = PrivateKey.generate();
        console.log("✅ All keys generated");

        // 4. DEPLOY NFT (WITH PROPER SIGNATURES)
        console.log("\n📦 Deploying NFT contract...");

        const transaction = new TokenCreateTransaction()
            .setTokenName("Odin")
            .setTokenSymbol("ODIN")
            .setTokenType(TokenType.NonFungibleUnique)
            .setTreasuryAccountId(process.env.OPERATOR_ID)
            .setAdminKey(adminKey)
            .setSupplyKey(supplyKey)
            .setPauseKey(pauseKey)
            .setFeeScheduleKey(feeScheduleKey)
            .setMaxTransactionFee(new Hbar(50))
            .freezeWith(client); // Freeze before signing

        console.log("💰 Max fee: 50 HBAR");
        console.log("🔏 Signing with all keys...");

        // CRITICAL: Sign with ALL the keys we're setting
        await transaction.sign(adminKey);
        await transaction.sign(supplyKey);
        await transaction.sign(pauseKey);
        await transaction.sign(feeScheduleKey);

        console.log("✅ All signatures added");
        console.log("⚡ Executing transaction...");

        const txResponse = await transaction.execute(client);
        console.log("✅ Transaction submitted");

        // 5. WAIT FOR CONFIRMATION (EXTENDED TIMEOUT)
        console.log("⏳ Waiting for confirmation (this can take 30-60 seconds)...");
        const transactionId = txResponse.transactionId;
        console.log("📋 Transaction ID:", transactionId.toString());

        let receipt;
        let retries = 0;
        const maxRetries = 15; // Increased from 5

        while (retries < maxRetries) {
            try {
                await new Promise(resolve => setTimeout(resolve, 4000)); // Wait 4 seconds between attempts
                receipt = await txResponse.getReceipt(client);
                console.log("✅ Receipt received!");
                break;
            } catch (error) {
                retries++;
                console.log(`🔄 Retry ${retries}/${maxRetries}... (${error.message || 'waiting'})`);

                // After 8 retries, suggest manual check
                if (retries === 8) {
                    console.log("\n💡 Taking longer than expected. Transaction may have succeeded.");
                    console.log("🔍 Check manually: https://hashscan.io/testnet/transaction/" + transactionId.toString());
                }
            }
        }

        if (!receipt || !receipt.tokenId) {
            console.log("\n⚠️  RECEIPT TIMEOUT");
            console.log("========================================");
            console.log("Your transaction was SUBMITTED but receipt timed out.");
            console.log("\n🔍 Check if it succeeded here:");
            console.log("https://hashscan.io/testnet/transaction/" + transactionId.toString());
            console.log("\nIf successful, you'll see your TOKEN ID on that page.");
            console.log("Then manually add it to your .env file as: TOKEN_ID=0.0.XXXXXX");
            console.log("========================================");
            process.exit(0); // Exit gracefully, not as error
        }

        const tokenId = receipt.tokenId;

        // 6. SUCCESS OUTPUT
        console.log("\n🎉 ✅ NFT DEPLOYED SUCCESSFULLY!");
        console.log("========================================");
        console.log("📝 TOKEN ID:", tokenId.toString());
        console.log("========================================\n");

        console.log("🔑 UPGRADE KEYS (SAVE THESE!):");
        console.log("ADMIN_KEY:", adminKey.toString());
        console.log("SUPPLY_KEY:", supplyKey.toString());
        console.log("PAUSE_KEY:", pauseKey.toString());
        console.log("FEE_SCHEDULE_KEY:", feeScheduleKey.toString());
        console.log("========================================\n");

        // 7. UPDATE ENVIRONMENT
        const fs = require('fs');
        const envContent =
            `OPERATOR_ID=${process.env.OPERATOR_ID}
OPERATOR_KEY=${process.env.OPERATOR_KEY}
NETWORK=testnet
TOKEN_ID=${tokenId.toString()}
ADMIN_KEY=${adminKey.toString()}
SUPPLY_KEY=${supplyKey.toString()}
PAUSE_KEY=${pauseKey.toString()}
FEE_SCHEDULE_KEY=${feeScheduleKey.toString()}
TREASURY_ACCOUNT_ID=${process.env.OPERATOR_ID}`;

        fs.writeFileSync('.env', envContent);
        console.log("💾 .env file updated automatically");

        // 8. NEXT STEPS
        console.log("\n🚀 NEXT STEPS:");
        console.log("1. Run: npm start");
        console.log("2. Your NFT minting site is READY");
        console.log("3. View: https://hashscan.io/testnet/token/" + tokenId.toString());
        console.log("\n✅ DEPLOYMENT COMPLETE!");

    } catch (error) {
        console.log("\n❌ DEPLOYMENT FAILED:", error.message);
        console.log("\n🔧 QUICK FIXES:");
        console.log("1. Check your .env file has correct OPERATOR_ID and OPERATOR_KEY");
        console.log("2. Make sure account has enough HBAR (you have 1078 ℏ)");
        console.log("3. Try a different Hedera testnet node");
        console.log("4. Your key format might be incompatible");
        process.exit(1);
    }
}

// RUN IT
deployNFT();