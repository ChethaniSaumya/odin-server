const { Client, PrivateKey, AccountBalanceQuery, TransferTransaction, Hbar } = require("@hashgraph/sdk");
require('dotenv').config();

async function diagnoseKeys() {
    console.log("🔍 HEDERA KEY DIAGNOSTIC TOOL v2");
    console.log("========================================\n");

    // Step 1: Check environment variables
    console.log("📋 Environment Variables:");
    console.log("OPERATOR_ID:", process.env.OPERATOR_ID || "❌ MISSING");
    console.log("OPERATOR_KEY:", process.env.OPERATOR_KEY ? "✅ Present" : "❌ MISSING");
    
    const rawKey = process.env.OPERATOR_KEY?.trim();
    if (rawKey) {
        const cleanKey = rawKey.replace(/^0x/, '');
        console.log("Key format:", cleanKey.length === 64 ? "⚠️  RAW HEX (32 bytes)" : "✅ DER-encoded");
        console.log("Key length:", cleanKey.length, "characters");
    }
    console.log("");

    if (!process.env.OPERATOR_ID || !process.env.OPERATOR_KEY) {
        console.log("❌ Missing credentials in .env file\n");
        return false;
    }

    // Step 2: Parse the private key
    console.log("🔑 Parsing Private Key...");
    let operatorKey;
    const keyString = process.env.OPERATOR_KEY.trim();

    try {
        // Remove 0x and try parsing
        const cleanKey = keyString.replace(/^0x/, '');
        
        try {
            operatorKey = PrivateKey.fromStringECDSA(cleanKey);
            console.log("✅ Parsed as ECDSA");
        } catch (e1) {
            try {
                operatorKey = PrivateKey.fromStringED25519(cleanKey);
                console.log("✅ Parsed as ED25519");
            } catch (e2) {
                operatorKey = PrivateKey.fromString(cleanKey);
                console.log("✅ Parsed with auto-detect");
            }
        }

        const publicKey = operatorKey.publicKey;
        console.log("📝 Public Key:", publicKey.toString().substring(0, 30) + "...");
        console.log("");

    } catch (error) {
        console.log("❌ FAILED to parse private key:", error.message);
        console.log("\n💡 Your OPERATOR_KEY format is invalid.\n");
        return false;
    }

    // Step 3: Test connection to Hedera
    console.log("🌐 Testing Hedera Connection...");
    const client = Client.forTestnet();

    try {
        client.setOperator(process.env.OPERATOR_ID, operatorKey);
        console.log("✅ Client configured\n");

        // Step 4: Query account balance (PUBLIC - doesn't test key ownership)
        console.log("💰 Querying Account Balance (public query)...");

        const balance = await new AccountBalanceQuery()
            .setAccountId(process.env.OPERATOR_ID)
            .execute(client);

        console.log("✅ Account exists");
        console.log("Balance:", balance.hbars.toString());
        console.log("");

        // Check if balance is sufficient
        const hbarAmount = balance.hbars.toBigNumber().toNumber();
        if (hbarAmount < 20) {
            console.log("⚠️  WARNING: Low balance!");
            console.log("You need at least 20 HBAR to deploy NFTs.\n");
            return false;
        }

        // Step 5: CRITICAL TEST - Actually sign a transaction
        console.log("🔐 CRITICAL TEST: Testing if key can sign transactions...");
        console.log("Creating a 0 HBAR transfer to verify signature authority...\n");

        try {
            // Create a transfer of 0 HBAR to ourselves - this requires signature
            const testTransaction = await new TransferTransaction()
                .addHbarTransfer(process.env.OPERATOR_ID, new Hbar(-0.001))
                .addHbarTransfer(process.env.OPERATOR_ID, new Hbar(0.001))
                .setMaxTransactionFee(new Hbar(1))
                .execute(client);

            // Wait for receipt
            await testTransaction.getReceipt(client);

            console.log("✅ ✅ ✅ SIGNATURE TEST PASSED!");
            console.log("========================================");
            console.log("Your key DOES control this account!");
            console.log("Account:", process.env.OPERATOR_ID);
            console.log("Balance:", balance.hbars.toString());
            console.log("========================================\n");
            console.log("🎉 Ready to deploy NFTs!\n");
            return true;

        } catch (sigError) {
            console.log("❌ ❌ ❌ SIGNATURE TEST FAILED!");
            console.log("========================================");
            console.log("Error:", sigError.message);
            
            if (sigError.message.includes("INVALID_SIGNATURE")) {
                console.log("\n🔴 ROOT CAUSE IDENTIFIED:");
                console.log("Your OPERATOR_KEY does NOT control account", process.env.OPERATOR_ID);
                console.log("\nThis key can be parsed, but it's the WRONG key for this account.\n");
                
                console.log("========================================");
                console.log("🔧 SOLUTION:");
                console.log("========================================");
                console.log("Option 1: Get the CORRECT key for", process.env.OPERATOR_ID);
                console.log("  1. Go to portal.hedera.com");
                console.log("  2. Find account:", process.env.OPERATOR_ID);
                console.log("  3. Copy the DER-encoded private key");
                console.log("  4. Update OPERATOR_KEY in .env");
                console.log("");
                console.log("Option 2: Create a NEW testnet account");
                console.log("  1. Go to portal.hedera.com");
                console.log("  2. Create new testnet account");
                console.log("  3. Copy BOTH Account ID and Private Key");
                console.log("  4. Update .env with new credentials");
                console.log("");
                console.log("Option 3: If this key is from MetaMask/HashPack");
                console.log("  - This is a raw EVM key (0x prefix)");
                console.log("  - Convert it: PrivateKey.fromStringECDSA(key)");
                console.log("  - But you may still need the original Hedera key\n");
            }
            
            console.log("========================================\n");
            return false;
        }

    } catch (error) {
        console.log("❌ Unexpected error:", error.message);
        return false;
    } finally {
        client.close();
    }
}

// Run diagnostic
diagnoseKeys().then(success => {
    if (success) {
        console.log("✅ All checks passed! Deploy will work.");
    } else {
        console.log("❌ Fix the issues above before deploying.");
    }
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error("❌ Unexpected error:", error);
    process.exit(1);
});