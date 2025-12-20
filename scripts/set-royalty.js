const {
    Client,
    PrivateKey,
    TokenFeeScheduleUpdateTransaction,
    CustomRoyaltyFee,
    CustomFixedFee,
    Hbar
} = require("@hashgraph/sdk");
require("dotenv").config();

async function setRoyalty() {
    console.log("👑 SETTING 8% ROYALTY FOR NFT COLLECTION");
    console.log("========================================\n");

    // Validate environment
    if (!process.env.TOKEN_ID) {
        console.log("❌ TOKEN_ID not found in .env");
        console.log("💡 Make sure your NFT collection is deployed first");
        process.exit(1);
    }

    if (!process.env.FEE_SCHEDULE_KEY) {
        console.log("❌ FEE_SCHEDULE_KEY not found in .env");
        console.log("💡 This key is needed to set royalties");
        process.exit(1);
    }

    console.log("✅ Environment check passed");
    console.log("🪙 Token ID:", process.env.TOKEN_ID);
    console.log("💰 Treasury:", process.env.TREASURY_ACCOUNT_ID || process.env.OPERATOR_ID);

    // Setup client
    const client = Client.forMainnet();
    
    try {
        // Parse operator key (ECDSA format - your key starts with 0x)
        const opKey = process.env.OPERATOR_KEY.trim();
        let operatorKey;
        
        if (opKey.startsWith("0x") || (opKey.length === 64 && !opKey.startsWith("302"))) {
            operatorKey = PrivateKey.fromStringECDSA(opKey.replace("0x", ""));
            console.log("✅ OPERATOR_KEY parsed (ECDSA format)");
        } else if (opKey.startsWith("302")) {
            operatorKey = PrivateKey.fromStringDer(opKey);
            console.log("✅ OPERATOR_KEY parsed (DER format)");
        } else {
            operatorKey = PrivateKey.fromStringED25519(opKey);
            console.log("✅ OPERATOR_KEY parsed (ED25519 format)");
        }
        
        client.setOperator(process.env.OPERATOR_ID, operatorKey);
        console.log("✅ Client configured\n");
        
        // Parse the fee schedule key (DER format)
        const feeScheduleKey = PrivateKey.fromStringDer(process.env.FEE_SCHEDULE_KEY);
        console.log("🔑 Fee schedule key loaded");

        // Define royalty recipient (your treasury)
        const treasuryAccountId = process.env.TREASURY_ACCOUNT_ID || process.env.OPERATOR_ID;

        console.log("\n📋 ROYALTY CONFIGURATION:");
        console.log("   Royalty Rate: 8%");
        console.log("   Recipient: " + treasuryAccountId);
        console.log("   Fallback Fee: 1 HBAR (if no token amount available)");

        // Create 8% royalty fee
        const royaltyFee = new CustomRoyaltyFee()
            .setNumerator(8)           // 8% numerator
            .setDenominator(100)       // 8% denominator
            .setFeeCollectorAccountId(treasuryAccountId)
            .setFallbackFee(
                new CustomFixedFee()
                    .setHbarAmount(new Hbar(1))  // 1 HBAR fallback
                    .setFeeCollectorAccountId(treasuryAccountId)
            );

        console.log("\n⚙️  Creating fee schedule update transaction...");

        // Create transaction
        const transaction = await new TokenFeeScheduleUpdateTransaction()
            .setTokenId(process.env.TOKEN_ID)
            .setCustomFees([royaltyFee])
            .freezeWith(client);

        console.log("🔐 Signing with FEE_SCHEDULE_KEY...");
        let signedTx = await transaction.sign(feeScheduleKey);
        
        // 🔥 CRITICAL FIX: Also sign with OPERATOR_KEY (treasury account)
        console.log("🔐 Signing with OPERATOR_KEY (treasury)...");
        signedTx = await signedTx.sign(operatorKey);
        
        console.log("✅ Double-signed (FEE_SCHEDULE_KEY + OPERATOR_KEY)");

        console.log("⚡ Executing transaction...");
        const txResponse = await signedTx.execute(client);

        console.log("⏳ Waiting for receipt...");
        const receipt = await txResponse.getReceipt(client);

        if (receipt.status.toString() === 'SUCCESS') {
            console.log("\n🎉 ✅ ROYALTY SET SUCCESSFULLY!");
            console.log("========================================");
            console.log("📊 Details:");
            console.log("   Token: " + process.env.TOKEN_ID);
            console.log("   Royalty: 8% on all secondary sales");
            console.log("   Recipient: " + treasuryAccountId);
            console.log("   Fallback: 1 HBAR");
            console.log("   Transaction: " + txResponse.transactionId.toString());
            console.log("========================================\n");

            console.log("🔗 View on HashScan:");
            console.log(`https://hashscan.io/mainnet/token/${process.env.TOKEN_ID}`);

            console.log("\n💡 WHAT THIS MEANS:");
            console.log("   • Every time an NFT is sold on a marketplace");
            console.log("   • 8% of the sale price goes to your treasury");
            console.log("   • This applies to ALL future sales");
            console.log("   • Royalties are enforced on Hedera marketplaces\n");

        } else {
            console.log("❌ Transaction failed:", receipt.status.toString());
            process.exit(1);
        }

    } catch (error) {
        console.error("\n❌ ROYALTY SETUP FAILED:", error.message);
        console.error("\n🔧 TROUBLESHOOTING:");
        console.error("1. Make sure FEE_SCHEDULE_KEY is correct in .env");
        console.error("2. Ensure you have enough HBAR for transaction fees");
        console.error("3. Check that TOKEN_ID is deployed and active");
        console.error("4. Verify you're using the correct network (mainnet/testnet)");
        console.error("5. Transaction must be signed by BOTH FEE_SCHEDULE_KEY and OPERATOR_KEY");
        
        console.error("\n📝 Full error:");
        console.error(error);
        process.exit(1);
    }

    client.close();
}

// Run the script
setRoyalty().catch(console.error);