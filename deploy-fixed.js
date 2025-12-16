// deploy-upgradeable-fixed.js
const { Client, PrivateKey, TokenCreateTransaction, TokenType, Hbar } = require("@hashgraph/sdk");
const fs = require('fs');
require("dotenv").config();

async function deployNFT() {
    console.log("🔫 UPGRADEABLE NFT DEPLOYMENT (FIXED FOR ECDSA)");
    console.log("========================================\n");

    // 1. VALIDATE ENVIRONMENT
    if (!process.env.OPERATOR_ID || !process.env.OPERATOR_KEY) {
        console.log("❌ MISSING: OPERATOR_ID or OPERATOR_KEY in .env");
        process.exit(1);
    }

    console.log("✅ Environment check passed");
    console.log("📝 Account:", process.env.OPERATOR_ID);

    // 2. CLIENT CONFIGURATION
    const client = Client.forTestnet();

    try {
        // FIXED KEY PARSING - HANDLES 0x ECDSA FORMAT
        let operatorKey;
        const keyString = process.env.OPERATOR_KEY.trim();
        
        // Remove 0x prefix if present
        const cleanKey = keyString.replace(/^0x/, '');

        console.log("\n🔑 Parsing operator key...");
        console.log("   Raw length:", keyString.length);
        console.log("   Clean length:", cleanKey.length);
        console.log("   Prefix:", keyString.substring(0, 6) + "...");

        // Determine key format based on characteristics
        if (cleanKey.length === 64 && !cleanKey.startsWith("302")) {
            // Raw 32-byte hex = ECDSA
            operatorKey = PrivateKey.fromStringECDSA(cleanKey);
            console.log("   ✅ Parsed as ECDSA (raw hex)");
        } else if (cleanKey.startsWith("302")) {
            // DER encoded
            operatorKey = PrivateKey.fromStringDer(cleanKey);
            console.log("   ✅ Parsed as DER encoded");
        } else if (cleanKey.length === 64) {
            // Try ED25519
            try {
                operatorKey = PrivateKey.fromStringED25519(cleanKey);
                console.log("   ✅ Parsed as ED25519");
            } catch (e) {
                operatorKey = PrivateKey.fromStringECDSA(cleanKey);
                console.log("   ✅ Parsed as ECDSA (fallback)");
            }
        } else {
            // Generic parse
            operatorKey = PrivateKey.fromString(cleanKey);
            console.log("   ✅ Parsed with auto-detect");
        }

        client.setOperator(process.env.OPERATOR_ID, operatorKey);
        console.log("   ✅ Client configured");

        // 3. GENERATE UPGRADE KEYS (ED25519 for consistent DER serialization)
        console.log("\n🔑 Generating upgrade keys (ED25519 for reliable DER format)...");
        
        const adminKey = PrivateKey.generateED25519();
        const supplyKey = PrivateKey.generateED25519();
        const pauseKey = PrivateKey.generateED25519();
        const feeScheduleKey = PrivateKey.generateED25519();
        
        console.log("   ✅ Admin Key generated");
        console.log("   ✅ Supply Key generated");
        console.log("   ✅ Pause Key generated");
        console.log("   ✅ Fee Schedule Key generated");

        // Verify keys serialize correctly
        console.log("\n🔍 Verifying key serialization...");
        const keysToVerify = { adminKey, supplyKey, pauseKey, feeScheduleKey };
        
        for (const [name, key] of Object.entries(keysToVerify)) {
            const derString = key.toStringDer();
            try {
                PrivateKey.fromStringDer(derString);
                console.log(`   ✅ ${name}: ${derString.length} chars, valid`);
            } catch (e) {
                throw new Error(`${name} serialization failed: ${e.message}`);
            }
        }

        // 4. DEPLOY NFT (WITH PROPER SIGNATURES)
        console.log("\n📦 Creating upgradeable NFT token...");
        console.log("   Name: Odin");
        console.log("   Symbol: ODIN");
        console.log("   Type: Non-Fungible Unique");
        console.log("   Treasury:", process.env.OPERATOR_ID);
        console.log("");
        console.log("   🔐 Upgrade Keys:");
        console.log("      Admin Key: ✅ (update name/symbol, pause)");
        console.log("      Supply Key: ✅ (mint NFTs)");
        console.log("      Pause Key: ✅ (pause/unpause)");
        console.log("      Fee Schedule Key: ✅ (update royalties)");

        const transaction = new TokenCreateTransaction()
            .setTokenName("Odin")
            .setTokenSymbol("ODIN")
            .setTokenType(TokenType.NonFungibleUnique)
            .setDecimals(0)
            .setInitialSupply(0)
            .setTreasuryAccountId(process.env.OPERATOR_ID)
            .setAdminKey(adminKey.publicKey)
            .setSupplyKey(supplyKey.publicKey)
            .setPauseKey(pauseKey.publicKey)
            .setFeeScheduleKey(feeScheduleKey.publicKey)
            .setMaxTransactionFee(new Hbar(50))
            .freezeWith(client);

        console.log("\n💰 Max fee: 50 HBAR");
        console.log("✍️  Signing with all keys...");

        // CRITICAL: Sign with ALL the keys we're setting
        let signedTx = await transaction.sign(adminKey);
        signedTx = await signedTx.sign(supplyKey);
        signedTx = await signedTx.sign(pauseKey);
        signedTx = await signedTx.sign(feeScheduleKey);

        console.log("   ✅ All signatures added");
        
        console.log("\n⚡ Executing transaction...");
        const txResponse = await signedTx.execute(client);
        console.log("   ✅ Transaction submitted");
        console.log("   📋 TX ID:", txResponse.transactionId.toString());

        // 5. WAIT FOR CONFIRMATION
        console.log("\n⏳ Waiting for confirmation...");

        let receipt;
        let retries = 0;
        const maxRetries = 15;

        while (retries < maxRetries) {
            try {
                await new Promise(resolve => setTimeout(resolve, 3000));
                receipt = await txResponse.getReceipt(client);
                console.log("   ✅ Receipt received!");
                break;
            } catch (error) {
                retries++;
                if (retries < maxRetries) {
                    console.log(`   🔄 Retry ${retries}/${maxRetries}...`);
                }
            }
        }

        if (!receipt || !receipt.tokenId) {
            console.log("\n⚠️  RECEIPT TIMEOUT");
            console.log("Check HashScan:", `https://hashscan.io/mainnet/transaction/${txResponse.transactionId.toString()}`);
            
            // Still save keys in case token was created
            const partialEnv = `# PARTIAL - Token may have been created, check HashScan
OPERATOR_ID=${process.env.OPERATOR_ID}
OPERATOR_KEY=${process.env.OPERATOR_KEY}
NETWORK=mainnet
TOKEN_ID=CHECK_HASHSCAN
ADMIN_KEY=${adminKey.toStringDer()}
SUPPLY_KEY=${supplyKey.toStringDer()}
PAUSE_KEY=${pauseKey.toStringDer()}
FEE_SCHEDULE_KEY=${feeScheduleKey.toStringDer()}
TREASURY_ACCOUNT_ID=${process.env.OPERATOR_ID}
PORT=3000
ADMIN_PASSWORD=${process.env.ADMIN_PASSWORD || 'admin123'}`;
            
            fs.writeFileSync('.env.partial', partialEnv);
            console.log("Keys saved to .env.partial - update TOKEN_ID manually after checking HashScan");
            
            return null;
        }

        const tokenId = receipt.tokenId;

        // 6. SUCCESS OUTPUT
        console.log("\n" + "=".repeat(50));
        console.log("🎉 NFT DEPLOYED SUCCESSFULLY!");
        console.log("=".repeat(50));
        console.log("📝 TOKEN ID:", tokenId.toString());
        console.log("🔍 HashScan:", `https://hashscan.io/mainnet/token/${tokenId.toString()}`);
        console.log("👤 Treasury:", process.env.OPERATOR_ID);
        console.log("");
        console.log("🔐 UPGRADE CAPABILITIES:");
        console.log("   ✅ Update name/symbol");
        console.log("   ✅ Mint new NFTs");
        console.log("   ✅ Pause/unpause transfers");
        console.log("   ✅ Update royalty fees");
        console.log("=".repeat(50));

        // 7. UPDATE ENVIRONMENT - USE toStringDer() FOR CONSISTENT FORMAT
        console.log("\n💾 Saving configuration...");
        
        const envContent = `# Hedera mainnet Configuration
OPERATOR_ID=${process.env.OPERATOR_ID}
OPERATOR_KEY=${process.env.OPERATOR_KEY}
NETWORK=mainnet

# Token
TOKEN_ID=${tokenId.toString()}
TREASURY_ACCOUNT_ID=${process.env.OPERATOR_ID}

# Upgrade Keys (ED25519 DER format - DO NOT LOSE THESE!)
ADMIN_KEY=${adminKey.toStringDer()}
SUPPLY_KEY=${supplyKey.toStringDer()}
PAUSE_KEY=${pauseKey.toStringDer()}
FEE_SCHEDULE_KEY=${feeScheduleKey.toStringDer()}

# Server
PORT=3000
ADMIN_PASSWORD=${process.env.ADMIN_PASSWORD || 'admin123'}

# GitHub (optional)
GITHUB_TOKEN=${process.env.GITHUB_TOKEN || ''}
GITHUB_REPO_OWNER=${process.env.GITHUB_REPO_OWNER || ''}
GITHUB_REPO_NAME=${process.env.GITHUB_REPO_NAME || ''}
GITHUB_BRANCH=${process.env.GITHUB_BRANCH || 'main'}

# Frontend (optional)
REACT_APP_WALLETCONNECT_PROJECT_ID=${process.env.REACT_APP_WALLETCONNECT_PROJECT_ID || ''}
`;

        fs.writeFileSync('.env', envContent);
        console.log("   ✅ .env updated");

        // Backup keys separately
        const backupContent = `# KEY BACKUP - ${new Date().toISOString()}
# Token ID: ${tokenId.toString()}
# KEEP THIS FILE SAFE!

ADMIN_KEY=${adminKey.toStringDer()}
SUPPLY_KEY=${supplyKey.toStringDer()}
PAUSE_KEY=${pauseKey.toStringDer()}
FEE_SCHEDULE_KEY=${feeScheduleKey.toStringDer()}
`;
        fs.writeFileSync('.env.keys.backup', backupContent);
        console.log("   ✅ Key backup saved to .env.keys.backup");

        // 8. FINAL VERIFICATION
        console.log("\n🔍 Final verification...");
        require('dotenv').config({ override: true });

        const keysToCheck = ['ADMIN_KEY', 'SUPPLY_KEY', 'PAUSE_KEY', 'FEE_SCHEDULE_KEY'];
        let allValid = true;

        for (const keyName of keysToCheck) {
            const keyValue = process.env[keyName];
            if (!keyValue) {
                console.log(`   ❌ ${keyName}: NOT SAVED`);
                allValid = false;
                continue;
            }
            
            try {
                PrivateKey.fromStringDer(keyValue);
                console.log(`   ✅ ${keyName}: Valid (${keyValue.length} chars)`);
            } catch (e) {
                console.log(`   ❌ ${keyName}: Parse failed - ${e.message}`);
                allValid = false;
            }
        }

        if (!allValid) {
            console.log("\n⚠️  Some keys failed verification!");
            console.log("   Check .env.keys.backup for original values");
        }

        console.log("\n" + "=".repeat(50));
        console.log("✅ DEPLOYMENT COMPLETE!");
        console.log("=".repeat(50));
        console.log("\nNext steps:");
        console.log("   1. node test-mint.js  (verify minting works)");
        console.log("   2. npm start          (start the server)");
        console.log("\n");

        return tokenId.toString();

    } catch (error) {
        console.log("\n❌ DEPLOYMENT FAILED:", error.message);
        
        if (error.message.includes("INVALID_SIGNATURE")) {
            console.log("\n💡 This usually means:");
            console.log("   - The operator key doesn't match the account");
            console.log("   - Check your OPERATOR_KEY in .env");
        }
        
        if (error.message.includes("INSUFFICIENT")) {
            console.log("\n💡 Get mainnet HBAR from:");
            console.log("   https://portal.hedera.com/faucet");
        }
        
        throw error;
    } finally {
        client.close();
    }
}

// Export for use in server.js
module.exports = { deployNFT };

// Run if called directly
if (require.main === module) {
    deployNFT().catch(console.error);
}