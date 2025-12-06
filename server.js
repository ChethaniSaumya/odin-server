const express = require('express');
const cors = require('cors');
require("dotenv").config();

const MintService = require('./services/mint-service');
const AirdropService = require('./services/airdrop-service');
const UpgradeService = require('./services/upgrade-service');
const {
    Client,
    PrivateKey,
    TokenCreateTransaction,
    TokenType,
    Hbar
} = require("@hashgraph/sdk");

const app = express();
app.use(cors());
app.use(express.json());

// ==================== MINT ROUTES ====================

/**
 * Step 1: Initiate minting process
 * POST /api/mint/initiate
 * Body: { userAccountId: "0.0.1234", rarity: "common" }
 */
app.post('/api/mint/initiate', async (req, res) => {
    try {
        const { userAccountId, rarity, quantity = 1 } = req.body;

        console.log('🔵 Initiate mint request:', { userAccountId, rarity, quantity });

        if (!userAccountId || !rarity) {
            return res.status(400).json({
                success: false,
                error: 'userAccountId and rarity are required'
            });
        }

        // Validate Hedera account format
        if (!userAccountId.match(/^\d+\.\d+\.\d+$/)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Hedera account format. Use: 0.0.1234'
            });
        }

        const mintService = new MintService();
        const result = await mintService.initiateMint(userAccountId, rarity, quantity);

        mintService.close();

        // Return payment details (without expected amount - frontend handles pricing)
        res.json({
            success: true,
            paymentId: result.paymentId,
            treasuryAccountId: result.treasuryAccountId || process.env.TREASURY_ACCOUNT_ID,
            message: 'Payment will be processed via wallet'
        });

    } catch (error) {
        console.error('Initiate mint error:', error.message);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});
/**
 * Step 2: Complete minting after payment
 * POST /api/mint/complete
 * Body: { paymentId: "payment-id-123" }
 */
app.post('/api/mint/complete', async (req, res) => {
    try {
        const { paymentId } = req.body;

        if (!paymentId) {
            return res.status(400).json({
                success: false,
                error: 'paymentId is required'
            });
        }

        const mintService = new MintService();
        const result = await mintService.completeMint(paymentId);
        mintService.close();

        res.json(result);

    } catch (error) {
        console.error('Complete mint error:', error.message);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Check if user has paid (simpler endpoint)
 * GET /api/mint/check-payment/:accountId
 */
app.get('/api/mint/check-payment/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;

        // Simple check: Query Mirror Node for user's last transaction
        const mirrorUrl = `https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=${accountId}&limit=1&order=desc`;
        const response = await fetch(mirrorUrl);

        if (!response.ok) {
            return res.json({
                success: false,
                status: 'mirror_node_error'
            });
        }

        const data = await response.json();

        if (!data.transactions || data.transactions.length === 0) {
            return res.json({
                success: true,
                status: 'no_transactions'
            });
        }

        const tx = data.transactions[0];
        const treasuryId = process.env.TREASURY_ACCOUNT_ID || process.env.OPERATOR_ID;

        // Check if this transaction sent to our treasury
        const isToTreasury = tx.transfers?.some(t =>
            t.amount > 0 && t.account === treasuryId
        );

        if (isToTreasury) {
            return res.json({
                success: true,
                status: 'payment_found',
                transactionId: tx.transaction_id,
                amount: tx.transfers.find(t => t.account === treasuryId)?.amount || 0,
                timestamp: tx.consensus_timestamp
            });
        }

        return res.json({
            success: true,
            status: 'no_payment',
            lastTransaction: tx.transaction_id
        });

    } catch (error) {
        console.error('Check payment error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * NEW APPROACH: Verify transaction hash and mint
 * POST /api/mint/verify-and-mint
 * Body: { userAccountId, rarity, quantity, transactionHash }
 */
app.post('/api/mint/verify-and-mint', async (req, res) => {
    console.log('\n🎯 VERIFY & MINT ENDPOINT CALLED');
    console.log('================================================');

    try {
        const { userAccountId, rarity, quantity, transactionHash } = req.body;

        console.log('📥 Request Received:');
        console.log('   User Account:', userAccountId);
        console.log('   Rarity:', rarity);
        console.log('   Quantity:', quantity);
        console.log('   Transaction Hash:', transactionHash);
        console.log('================================================\n');

        // Validate required parameters
        if (!userAccountId || !rarity || !quantity || !transactionHash) {
            console.log('❌ Missing required parameters');
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: userAccountId, rarity, quantity, transactionHash'
            });
        }

        // Validate rarity
        if (!['common', 'rare', 'legendary'].includes(rarity)) {
            console.log('❌ Invalid rarity:', rarity);
            return res.status(400).json({
                success: false,
                error: 'Invalid rarity. Must be: common, rare, or legendary'
            });
        }

        const treasuryId = process.env.TREASURY_ACCOUNT_ID || process.env.OPERATOR_ID;
        console.log(`💰 Treasury: ${treasuryId}`);
        console.log(`👤 User: ${userAccountId}`);
        console.log(`🎨 Rarity: ${rarity} x${quantity}`);

        const normalizeTransactionId = (txId) => {
            console.log('🔧 Normalizing:', txId);

            // Format 1: 0.0.7256495@1764776993.503788243 (WalletConnect/Hedera SDK format)
            if (txId.includes('@')) {
                const parts = txId.split('@');
                const accountId = parts[0];
                const rest = parts[1].split('.');
                return `${accountId}-${rest[0]}-${rest[1]}`;
            }

            // Format 2: 0.0.7256495-1764775552-702284690 (Mirror Node format)
            if (txId.includes('-')) {
                const parts = txId.split('-');
                if (parts.length === 3) {
                    return txId;
                }
            }

            return txId;
        };

        // STEP 1: Check if transaction hash already used
        console.log('\n📂 STEP 1: Checking if transaction already used...');
        console.log('================================================');

        const fs = require('fs');
        const path = require('path');
        const usedTxFile = path.join(__dirname, 'data', 'used-transactions.json');

        let usedTransactions = {};
        try {
            const data = fs.readFileSync(usedTxFile, 'utf8');
            usedTransactions = JSON.parse(data);
            console.log(`   Found ${Object.keys(usedTransactions).length} previously used transactions`);
        } catch (error) {
            console.log('   No previous transaction file found, creating new one');
            usedTransactions = {};
        }

        const normalizedInputHash = normalizeTransactionId(transactionHash);

        const alreadyUsed = Object.keys(usedTransactions).some(key =>
            normalizeTransactionId(key) === normalizedInputHash
        );

        if (alreadyUsed) {
            const usedEntry = Object.entries(usedTransactions).find(([key, value]) =>
                normalizeTransactionId(key) === normalizedInputHash
            );
            console.log('❌ Transaction already used!');
            console.log('   Used at:', usedEntry[1].timestamp);
            console.log('================================================\n');
            return res.status(400).json({
                success: false,
                error: 'This payment has already been used to mint an NFT',
                usedAt: usedEntry[1].timestamp
            });
        }
        console.log('   ✅ Transaction hash is new and unused');
        console.log('================================================\n');

        // STEP 2: Wait and fetch transactions from Mirror Node with retry
        console.log('🔍 STEP 2: Fetching transaction from Mirror Node (with retry)...');
        console.log('================================================');
        console.log('   Looking for:', transactionHash);
        console.log('   Normalized:', normalizedInputHash);
        console.log('');

        let matchingTx = null;
        const maxAttempts = 10;
        const retryDelay = 3000;
        let lastMirrorData = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            console.log(`   Attempt ${attempt}/${maxAttempts}...`);

            const mirrorUrl = `https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=${userAccountId}&transactiontype=CRYPTOTRANSFER&limit=10&order=desc`;

            try {
                const mirrorResponse = await fetch(mirrorUrl);

                if (!mirrorResponse.ok) {
                    console.log(`   ⚠️ Mirror Node error: ${mirrorResponse.status}`);
                    if (attempt === maxAttempts) {
                        console.log('================================================\n');
                        return res.status(500).json({
                            success: false,
                            error: 'Failed to fetch transactions from Hedera Mirror Node'
                        });
                    }
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                }

                const mirrorData = await mirrorResponse.json();
                lastMirrorData = mirrorData;

                if (!mirrorData.transactions || mirrorData.transactions.length === 0) {
                    console.log(`   ⚠️ No transactions found`);
                    if (attempt === maxAttempts) {
                        console.log('================================================\n');
                        return res.status(400).json({
                            success: false,
                            error: 'No recent transactions found for this wallet'
                        });
                    }
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                }

                console.log(`   Found ${mirrorData.transactions.length} transactions`);

                matchingTx = mirrorData.transactions.find(tx => {
                    const normalizedMirrorTx = normalizeTransactionId(tx.transaction_id);
                    return normalizedMirrorTx === normalizedInputHash;
                });

                if (matchingTx) {
                    console.log(`   ✅ Transaction found!`);
                    console.log(`   Transaction ID: ${matchingTx.transaction_id}`);
                    console.log(`   Status: ${matchingTx.result}`);
                    break;
                } else {
                    console.log(`   ⚠️ Transaction not visible in Mirror Node yet`);
                    if (attempt < maxAttempts) {
                        console.log(`   ⏳ Waiting ${retryDelay / 1000} seconds before retry...`);
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                    }
                }
            } catch (fetchError) {
                console.log(`   ⚠️ Fetch error:`, fetchError.message);
                if (attempt === maxAttempts) {
                    console.log('================================================\n');
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to query Mirror Node'
                    });
                }
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }

        console.log('================================================\n');

        if (!matchingTx) {
            console.log('❌ Transaction not found after all retries');
            return res.status(400).json({
                success: false,
                error: 'Transaction not found in Mirror Node after 30 seconds.',
                debug: {
                    lookingFor: transactionHash,
                    normalized: normalizedInputHash
                }
            });
        }

        // STEP 3: Verify transaction details
        console.log('✅ STEP 3: Verifying transaction details...');
        console.log('================================================');

        if (matchingTx.result !== 'SUCCESS') {
            console.log('❌ Transaction status is not SUCCESS');
            return res.status(400).json({
                success: false,
                error: `Transaction failed with status: ${matchingTx.result}`
            });
        }
        console.log('   ✅ Transaction status: SUCCESS');

        const transfers = matchingTx.transfers || [];
        const treasuryTransfer = transfers.find(t => t.account === treasuryId && t.amount > 0);
        const userTransfer = transfers.find(t => t.account === userAccountId && t.amount < 0);

        if (!treasuryTransfer) {
            return res.status(400).json({
                success: false,
                error: 'Transaction does not show a payment to treasury'
            });
        }

        if (!userTransfer) {
            return res.status(400).json({
                success: false,
                error: 'Transaction does not show a payment from your account'
            });
        }

        const amountSentTinybars = Math.abs(userTransfer.amount);
        const amountSentHbar = amountSentTinybars / 100000000;
        const perNFTCost = amountSentHbar / quantity;

        const expectedPrices = { common: 14, rare: 72, legendary: 220 };
        const expectedPrice = expectedPrices[rarity];
        const tolerance = expectedPrice * 0.01;
        const priceDifference = Math.abs(perNFTCost - expectedPrice);

        if (priceDifference > tolerance) {
            return res.status(400).json({
                success: false,
                error: `Payment amount doesn't match. Expected ${expectedPrice} HBAR per NFT, got ${perNFTCost.toFixed(2)} HBAR`
            });
        }
        console.log('   ✅ Price verified');
        console.log('================================================\n');

        // STEP 4: Save transaction hash to prevent reuse
        console.log('💾 STEP 4: Saving transaction hash...');
        usedTransactions[transactionHash] = {
            userAccountId,
            rarity,
            quantity,
            amountHbar: amountSentHbar,
            timestamp: new Date().toISOString(),
            normalizedHash: normalizedInputHash
        };

        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(usedTxFile, JSON.stringify(usedTransactions, null, 2));
        console.log('   ✅ Transaction marked as used');
        console.log('================================================\n');

        // STEP 5: Mint the NFT(s)
        console.log(`🎨 STEP 5: Minting ${quantity} ${rarity} NFT(s)...`);
        console.log('================================================');

        const MintService = require('./services/mint-service');
        const mintService = new MintService();

        try {
            const mintResults = [];

            for (let i = 0; i < quantity; i++) {
                console.log(`   [${i + 1}/${quantity}] Minting ${rarity} NFT...`);
                const result = await mintService.mintByRarity(userAccountId, rarity);
                mintResults.push(result);
                console.log(`   [${i + 1}/${quantity}] ✅ Minted - Serial: #${result.serialNumber}, Metadata ID: ${result.metadataTokenId}`);
            }

            mintService.close();

            console.log('\n================================================');
            console.log('🎉 ✅ MINTING COMPLETE!');
            console.log('================================================\n');

            // Define tier names and ODIN allocations
            const tierNames = { common: 'Common', rare: 'Rare', legendary: 'Legendary' };
            const odinAllocations = { common: 40000, rare: 300000, legendary: 1000000 };

            // Build response using mintResults array
            return res.json({
                success: true,
                message: `Successfully minted ${quantity} ${rarity} NFT${quantity > 1 ? 's' : ''}!`,
                nftDetails: mintResults.map(result => ({
                    tokenId: process.env.TOKEN_ID,
                    serialNumber: result.serialNumber,
                    metadataTokenId: result.metadataTokenId,
                    rarity: rarity,
                    tierName: tierNames[rarity],
                    odinAllocation: odinAllocations[rarity],
                    metadataUrl: result.metadataUrl,
                    transactionId: result.transactionId
                })),
                transactionHash: transactionHash,
                mintedCount: mintResults.length
            });

        } catch (mintError) {
            mintService.close();
            console.error('❌ MINTING FAILED:', mintError.message);

            // Remove transaction from used list since minting failed
            delete usedTransactions[transactionHash];
            fs.writeFileSync(usedTxFile, JSON.stringify(usedTransactions, null, 2));
            console.log('   ℹ️ Transaction removed from used list (minting failed)');

            return res.status(500).json({
                success: false,
                error: `Minting failed: ${mintError.message}`,
                note: 'Your payment was verified but minting failed. Please contact support.',
                transactionHash: transactionHash
            });
        }

    } catch (error) {
        console.error('❌ VERIFY & MINT ERROR:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

// Add this to server.js temporarily
app.get('/api/debug/token-info', async (req, res) => {
    try {
        const { TokenInfoQuery } = require("@hashgraph/sdk");
        const client = Client.forTestnet();
        client.setOperator(process.env.OPERATOR_ID, process.env.OPERATOR_KEY);

        const query = new TokenInfoQuery()
            .setTokenId(process.env.TOKEN_ID);

        const info = await query.execute(client);

        console.log('🔍 Token Info:');
        console.log('   Token ID:', info.tokenId.toString());
        console.log('   Name:', info.name);
        console.log('   Treasury:', info.treasuryAccountId.toString());
        console.log('   Supply Key:', info.supplyKey ? 'Set' : 'Not Set');
        console.log('   Admin Key:', info.adminKey ? 'Set' : 'Not Set');
        console.log('   Pause Key:', info.pauseKey ? 'Set' : 'Not Set');

        res.json({
            tokenId: info.tokenId.toString(),
            supplyKeyConfigured: !!info.supplyKey,
            adminKeyConfigured: !!info.adminKey,
            pauseKeyConfigured: !!info.pauseKey
        });
    } catch (error) {
        console.error('Token info error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Debug endpoint for transaction ID formats
 */
app.post('/api/debug/transaction-format', async (req, res) => {
    try {
        const { transactionId } = req.body;

        // Test normalization
        const normalizeTransactionId = (txId) => {
            if (txId.includes('@')) {
                const parts = txId.split('@');
                const accountId = parts[0];
                const rest = parts[1].split('.');
                return `${accountId}-${rest[0]}-${rest[1]}`;
            }
            return txId;
        };

        const normalized = normalizeTransactionId(transactionId);

        res.json({
            success: true,
            original: transactionId,
            normalized: normalized,
            formats: {
                hasAtSymbol: transactionId.includes('@'),
                hasDash: transactionId.includes('-'),
                parts: transactionId.split(/[@.-]/)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/mint/check-and-mint', async (req, res) => {
    console.log('\n🎯 CHECK & MINT ENDPOINT CALLED');

    try {
        const { userAccountId, expectedAmount, rarity } = req.body;

        console.log('📥 Request:', { userAccountId, expectedAmount, rarity });

        if (!userAccountId || expectedAmount === undefined || !rarity) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters'
            });
        }

        const treasuryId = process.env.TREASURY_ACCOUNT_ID || process.env.OPERATOR_ID;
        console.log(`💰 User (payer): ${userAccountId}`);
        console.log(`💰 Treasury (receiver): ${treasuryId}`);
        console.log(`💰 Expected: ${expectedAmount} HBAR`);

        // Wait 3 seconds for transaction to appear
        console.log('⏳ Waiting for transaction propagation...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Check TREASURY'S transactions for incoming payments FROM user
        console.log(`🔍 Checking treasury ${treasuryId} for incoming payments FROM ${userAccountId}...`);

        try {
            // Query treasury's transaction history
            const simpleCheck = await fetch(
                `http://localhost:3000/api/simple-transactions/${treasuryId}?limit=10`
            );
            const simpleData = await simpleCheck.json();

            if (!simpleData.success) {
                return res.json({
                    success: false,
                    status: 'no_payment',
                    error: 'Could not fetch treasury transaction history'
                });
            }

            console.log(`📊 Found ${simpleData.transactions?.length || 0} transactions for treasury ${treasuryId}`);

            // Look for incoming payments TO treasury FROM user
            const paymentFound = simpleData.transactions.find(tx => {
                // Must be incoming TO treasury
                if (tx.direction === 'incoming') {
                    console.log(`   Found incoming: ${tx.amount} from ${tx.counterparty}`);

                    // Check if payment came from the user
                    const fromUser = tx.counterparty === userAccountId;

                    // Check if amount matches
                    const txAmount = parseFloat(tx.amount.split(' ')[0]);
                    const expected = parseFloat(expectedAmount);
                    const tolerance = 0.01; // 1% tolerance for fees
                    const minAmount = expected * (1 - tolerance);
                    const maxAmount = expected * (1 + tolerance);

                    const amountMatches = txAmount >= minAmount && txAmount <= maxAmount;

                    if (fromUser && amountMatches) {
                        console.log(`   ✅ Perfect match! ${txAmount} HBAR from ${userAccountId}`);
                        return true;
                    } else if (amountMatches && !fromUser) {
                        console.log(`   ⚠️  Amount matches but wrong sender: ${tx.counterparty} (expected ${userAccountId})`);
                    }
                }
                return false;
            });

            if (!paymentFound) {
                console.log('❌ No matching payment found.');
                console.log('   All incoming payments to treasury:');
                simpleData.transactions
                    .filter(tx => tx.direction === 'incoming')
                    .forEach(tx => {
                        console.log(`   - ${tx.amount} from ${tx.counterparty}`);
                    });

                return res.json({
                    success: false,
                    status: 'no_payment',
                    error: `No payment of ~${expectedAmount} HBAR found from ${userAccountId} to treasury ${treasuryId}`,
                    userAccountId,
                    treasuryId,
                    expectedAmount,
                    actualIncoming: simpleData.transactions
                        .filter(tx => tx.direction === 'incoming')
                        .map(tx => ({ amount: tx.amount, from: tx.counterparty }))
                });
            }

            console.log('✅ Payment verified!');
            console.log('   Transaction:', paymentFound.id);
            console.log('   Amount:', paymentFound.amount);
            console.log('   From:', paymentFound.counterparty);
            console.log('   To:', treasuryId);

            // Now mint the NFT
            console.log(`\n🎨 Minting ${rarity} NFT to ${userAccountId}...`);

            const mintService = new MintService();

            try {
                const mintResult = await mintService.mintByRarity(userAccountId, rarity);
                mintService.close();

                console.log('✅ MINT SUCCESS!');
                console.log('   Serial:', mintResult.serialNumber);

                return res.json({
                    success: true,
                    status: 'minted',
                    message: 'NFT minted successfully!',
                    nftDetails: mintResult
                });

            } catch (mintError) {
                mintService.close();
                console.error('❌ MINT FAILED:', mintError.message);

                if (mintError.message.includes('INVALID_SIGNATURE')) {
                    return res.json({
                        success: false,
                        status: 'signature_error',
                        error: 'Minting failed due to invalid key signature. Redeploy NFT collection.',
                        fix: 'Run: node scripts/deploy-ultimate.js'
                    });
                }

                return res.json({
                    success: false,
                    status: 'mint_error',
                    error: mintError.message
                });
            }

        } catch (checkError) {
            console.error('Payment check error:', checkError);
            return res.json({
                success: false,
                status: 'check_error',
                error: 'Failed to verify payment'
            });
        }

    } catch (error) {
        console.error('❌ CHECK & MINT ENDPOINT ERROR:', error.message);

        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Add this to check configuration
app.get('/api/debug/config', (req, res) => {
    res.json({
        TREASURY_ACCOUNT_ID: process.env.TREASURY_ACCOUNT_ID,
        OPERATOR_ID: process.env.OPERATOR_ID,
        TOKEN_ID: process.env.TOKEN_ID,
        NOTE: 'Make sure TREASURY_ACCOUNT_ID=0.0.7258242 in .env'
    });
});

/**
 * SIMPLE: Get last transactions for any Hedera account
 * GET /api/simple-transactions/:accountId
 */
app.get('/api/simple-transactions/:accountId', async (req, res) => {
    try {
        const accountId = req.params.accountId;
        const limit = req.query.limit || 5;

        console.log(`📊 Getting ${limit} transactions for ${accountId}`);

        // Simple validation
        if (!accountId.match(/^\d+\.\d+\.\d+$/)) {
            return res.json({
                success: false,
                error: 'Invalid account format. Use: 0.0.1234'
            });
        }

        // Build SIMPLE URL - NO timestamp filters
        const mirrorUrl = `https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=${accountId}&limit=${limit}&order=desc`;

        console.log(`🔍 Calling: ${mirrorUrl}`);

        // Simple fetch
        const response = await fetch(mirrorUrl);
        const data = await response.json();

        // Format SIMPLE response
        const simpleTransactions = (data.transactions || []).map(tx => {
            // Find if this account sent or received HBAR
            let direction = 'unknown';
            let amount = 0;
            let counterparty = null;

            if (tx.transfers && tx.transfers.length > 0) {
                // Find transfers involving this account
                const accountTransfer = tx.transfers.find(t => t.account === accountId);
                if (accountTransfer) {
                    amount = Math.abs(accountTransfer.amount);
                    direction = accountTransfer.amount > 0 ? 'incoming' : 'outgoing';

                    // Find counterparty
                    const otherTransfer = tx.transfers.find(t =>
                        t.account !== accountId && Math.abs(t.amount) === amount
                    );
                    counterparty = otherTransfer ? otherTransfer.account : 'unknown';
                }
            }

            return {
                id: tx.transaction_id,
                time: tx.consensus_timestamp,
                type: tx.name || 'unknown',
                direction: direction,
                amount: (amount / 100000000).toFixed(2) + ' HBAR',
                counterparty: counterparty,
                fee: (parseInt(tx.charged_tx_fee || 0) / 100000000).toFixed(4) + ' HBAR',
                status: tx.result === 'SUCCESS' ? 'success' : 'failed',
                hashscan: `https://hashscan.io/testnet/transaction/${tx.transaction_id}`
            };
        });

        res.json({
            success: true,
            account: accountId,
            total: simpleTransactions.length,
            transactions: simpleTransactions,
            rawData: data // Include raw for debugging
        });

    } catch (error) {
        console.error('❌ Simple transaction error:', error.message);
        res.json({
            success: false,
            error: error.message,
            tip: 'Account might have no transactions yet'
        });
    }
});

/**
 * Check payment status
 * GET /api/mint/status/:paymentId
 */
app.get('/api/mint/status/:paymentId', async (req, res) => {
    try {
        const { paymentId } = req.params;

        const mintService = new MintService();
        const status = await mintService.checkPaymentStatus(paymentId);
        mintService.close();

        res.json({
            success: true,
            ...status
        });

    } catch (error) {
        console.error('Status check error:', error.message);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get minting statistics
 * GET /api/mint/stats
 */
app.get('/api/mint/stats', async (req, res) => {
    try {
        const mintService = new MintService();

        // Get stats from the categorized tier service
        const tierStats = mintService.tierService.getTierStats();

        // Calculate actual total minted from tier stats
        const actualTotalMinted = tierStats.common.minted + 
                                   tierStats.rare.minted + 
                                   tierStats.legendary.minted + 
                                   (tierStats.legendary_1of1?.minted || 0);

        const stats = {
            success: true,
            totalMinted: actualTotalMinted,
            maxSupply: mintService.maxSupply,
            remaining: mintService.maxSupply - actualTotalMinted,
            percentMinted: ((actualTotalMinted / mintService.maxSupply) * 100).toFixed(2),
            byRarity: {
                common: {
                    available: tierStats.common.available,
                    total: tierStats.common.total,
                    minted: tierStats.common.minted,
                    price: mintService.pricing.common.toString(),
                    odinAllocation: mintService.odinAllocation.common
                },
                rare: {
                    available: tierStats.rare.available,
                    total: tierStats.rare.total,
                    minted: tierStats.rare.minted,
                    price: mintService.pricing.rare.toString(),
                    odinAllocation: mintService.odinAllocation.rare
                },
                legendary: {
                    available: tierStats.legendary.available,
                    total: tierStats.legendary.total,
                    minted: tierStats.legendary.minted,
                    price: mintService.pricing.legendary.toString(),
                    odinAllocation: mintService.odinAllocation.legendary
                }
            }
        };

        console.log('📊 Stats endpoint response:', JSON.stringify(stats, null, 2));

        mintService.close();
        res.json(stats);

    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
/**
 * Get available tiers and pricing
 * GET /api/mint/pricing
 */
app.get('/api/mint/pricing', async (req, res) => {
    try {
        const mintService = new MintService();
        const pricing = {
            common: {
                price: 14, // Changed from "14 HBAR" to 14
                tinybars: new Hbar(14).toTinybars().toString(),
                odinAllocation: 40000,
                available: mintService.getAvailableByRarity('common')
            },
            rare: {
                price: 72, // Changed from "72 HBAR" to 72
                tinybars: new Hbar(72).toTinybars().toString(),
                odinAllocation: 300000,
                available: mintService.getAvailableByRarity('rare')
            },
            legendary: {
                price: 220, // Changed from "220 HBAR" to 220
                tinybars: new Hbar(220).toTinybars().toString(),
                odinAllocation: 1000000,
                available: mintService.getAvailableByRarity('legendary')
            }
        };

        mintService.close();

        res.json({
            success: true,
            pricing
        });
    } catch (error) {
        console.error('Pricing error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Test route to verify API is working
 * GET /api/mint/test
 */
app.get('/api/mint/test', (req, res) => {
    res.json({
        success: true,
        message: 'Mint API is working!',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// ==================== DEPLOYMENT ROUTES ====================

async function deployNFT() {
    console.log("🔫 BULLETPROOF NFT DEPLOYMENT");
    console.log("========================================\n");

    // 1. VALIDATE ENVIRONMENT
    if (!process.env.OPERATOR_ID || !process.env.OPERATOR_KEY) {
        console.log("❌ MISSING: OPERATOR_ID or OPERATOR_KEY in .env");
        process.exit(1);
    }

    console.log("✅ Environment check passed");
    console.log("📝 Account:", process.env.OPERATOR_ID);

    // 2. FIXED CLIENT CONFIGURATION
    const client = Client.forTestnet();

    try {
        // IMPROVED KEY PARSING - HANDLES HEX FORMAT
        let operatorKey;
        const keyString = process.env.OPERATOR_KEY.trim();

        console.log("🔑 Parsing private key...");

        // Remove 0x prefix if present
        const cleanKey = keyString.replace(/^0x/, '');

        console.log("Key length:", cleanKey.length);
        console.log("Key sample:", cleanKey.substring(0, 10) + "...");

        // Method 1: Try as ECDSA (most common for EVM addresses)
        try {
            operatorKey = PrivateKey.fromStringECDSA(keyString);
            console.log("✅ ECDSA format successful");
        } catch (e1) {
            // Method 2: Try HEX format without 0x
            try {
                operatorKey = PrivateKey.fromStringECDSA(cleanKey);
                console.log("✅ HEX format (without 0x) successful");
            } catch (e2) {
                // Method 3: Try ED25519
                try {
                    operatorKey = PrivateKey.fromStringED25519(keyString);
                    console.log("✅ ED25519 format successful");
                } catch (e3) {
                    // Method 4: Try standard DER
                    try {
                        operatorKey = PrivateKey.fromString(keyString);
                        console.log("✅ Standard DER format successful");
                    } catch (e4) {
                        console.log("❌ ALL KEY FORMATS FAILED");
                        console.log("Key provided:", keyString);
                        console.log("Clean key:", cleanKey);
                        throw new Error("Cannot parse private key. Try a different account.");
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
            .freezeWith(client);

        console.log("💰 Max fee: 50 HBAR");
        console.log("🔏 Signing with all keys...");

        // CRITICAL: Sign with ALL the keys we're setting
        const signedTx = await transaction.sign(adminKey);
        const signedTx2 = await signedTx.sign(supplyKey);
        const signedTx3 = await signedTx2.sign(pauseKey);
        const signedTx4 = await signedTx3.sign(feeScheduleKey);

        console.log("✅ All signatures added");
        console.log("⚡ Executing transaction...");

        const txResponse = await signedTx4.execute(client);
        console.log("✅ Transaction submitted");

        // 5. WAIT FOR CONFIRMATION
        console.log("⏳ Waiting for confirmation (this can take 30-60 seconds)...");

        let receipt;
        let retries = 0;
        const maxRetries = 15;

        while (retries < maxRetries) {
            try {
                await new Promise(resolve => setTimeout(resolve, 4000));
                receipt = await txResponse.getReceipt(client);
                console.log("✅ Receipt received!");
                break;
            } catch (error) {
                retries++;
                console.log(`🔄 Retry ${retries}/${maxRetries}...`);
            }
        }

        if (!receipt || !receipt.tokenId) {
            console.log("\n⚠️  RECEIPT TIMEOUT - Check HashScan manually");
            return null;
        }

        const tokenId = receipt.tokenId;

        // 6. SUCCESS OUTPUT
        console.log("\n🎉 ✅ NFT DEPLOYED SUCCESSFULLY!");
        console.log("========================================");
        console.log("📝 TOKEN ID:", tokenId.toString());
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
TREASURY_ACCOUNT_ID=${process.env.OPERATOR_ID}
PORT=3000
ADMIN_PASSWORD=${process.env.ADMIN_PASSWORD || 'admin123'}`;

        fs.writeFileSync('.env', envContent);
        console.log("💾 .env file updated automatically");

        return tokenId.toString();

    } catch (error) {
        console.log("\n❌ DEPLOYMENT FAILED:", error.message);
        throw error;
    }
}

/**
 * Debug endpoint to see what's happening during initialization
 */
app.post('/api/debug-tiers', async (req, res) => {
    try {
        const { adminPassword } = req.body;

        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        const mintService = new MintService();
        const tierService = mintService.tierService;

        console.log('🧪 DEBUG: Testing tier initialization...');

        // Test specific tokens that we know have different rarities
        const testTokens = [1, 2, 5, 24];
        let results = [];

        for (const tokenId of testTokens) {
            try {
                const rarity = await tierService.getTierFromMetadata(tokenId);
                results.push({ tokenId, rarity });
                console.log(`✅ Token ${tokenId}: ${rarity}`);
            } catch (error) {
                results.push({ tokenId, error: error.message });
                console.log(`❌ Token ${tokenId}: ${error.message}`);
            }
        }

        // Now run a mini-initialization on first 100 tokens
        console.log('🧪 DEBUG: Running mini-initialization (first 100 tokens)...');

        let common = 0, rare = 0, legendary = 0;
        for (let tokenId = 1; tokenId <= 100; tokenId++) {
            try {
                const rarity = await tierService.getTierFromMetadata(tokenId);
                if (rarity === 'common') common++;
                else if (rarity === 'rare') rare++;
                else if (rarity === 'legendary') legendary++;

                if (tokenId <= 10) {
                    console.log(`  Token ${tokenId}: ${rarity}`);
                }
            } catch (error) {
                console.log(`  Token ${tokenId} error: ${error.message}`);
            }
        }

        mintService.close();

        res.json({
            success: true,
            sampleTokens: results,
            miniDistribution: {
                common,
                rare,
                legendary,
                total: common + rare + legendary
            },
            message: "Check server console for detailed output"
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/deploy', async (req, res) => {
    try {
        const { adminPassword } = req.body;

        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        console.log("🚀 Starting NFT deployment via API...");
        const tokenId = await deployNFT();

        if (!tokenId) {
            return res.json({
                success: true,
                message: "Deployment submitted but receipt timed out. Check HashScan for token ID.",
                checkUrl: "https://hashscan.io/testnet"
            });
        }

        res.json({
            success: true,
            message: "NFT collection deployed successfully!",
            tokenId: tokenId,
            nextSteps: [
                "Server will automatically restart with new token ID",
                "Initialize tiers: POST /api/initialize-tiers",
                "Start minting: POST /api/mint"
            ]
        });

        // Restart server after successful deployment
        console.log("🔄 Restarting server with new token configuration...");
        process.exit(0);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Check deployment status
 * GET /api/deploy/status
 */
app.get('/api/deploy/status', async (req, res) => {
    try {
        const hasTokenId = !!process.env.TOKEN_ID;
        const hasOperator = !!(process.env.OPERATOR_ID && process.env.OPERATOR_KEY);

        res.json({
            success: true,
            deployed: hasTokenId,
            tokenId: process.env.TOKEN_ID || 'Not deployed',
            operatorId: process.env.OPERATOR_ID || 'Not set',
            readyForMinting: hasTokenId && hasOperator,
            missing: {
                operatorId: !process.env.OPERATOR_ID,
                operatorKey: !process.env.OPERATOR_KEY,
                tokenId: !process.env.TOKEN_ID
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Auto-deploy if not already deployed (for first-time setup)
 */
app.post('/api/deploy/auto', async (req, res) => {
    try {
        const { adminPassword } = req.body;

        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        // Check if already deployed
        if (process.env.TOKEN_ID) {
            return res.json({
                success: true,
                message: "NFT collection already deployed",
                tokenId: process.env.TOKEN_ID,
                status: "ready"
            });
        }

        // Deploy if not deployed
        console.log("🚀 Auto-deploying NFT collection...");
        const tokenId = await deployNFT();

        res.json({
            success: true,
            message: "NFT collection auto-deployed successfully!",
            tokenId: tokenId,
            status: "deployed"
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== AIRDROP ENDPOINTS ====================

app.post('/api/airdrop', async (req, res) => {
    try {
        const { snapshotData } = req.body;

        const airdropService = new AirdropService();
        const results = await airdropService.distributeAirdrop(snapshotData);

        res.json({ success: true, ...results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== UPGRADE ENDPOINTS ====================

app.post('/api/upgrade/name', async (req, res) => {
    try {
        const { newName, adminPassword } = req.body;

        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        const client = Client.forTestnet();
        client.setOperator(process.env.OPERATOR_ID, process.env.OPERATOR_KEY);
        const upgradeService = new UpgradeService(client, process.env.TOKEN_ID);

        const result = await upgradeService.updateTokenName(newName);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/upgrade/royalties', async (req, res) => {
    try {
        const { royaltyStructure, adminPassword } = req.body;

        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        const client = Client.forTestnet();
        client.setOperator(process.env.OPERATOR_ID, process.env.OPERATOR_KEY);
        const upgradeService = new UpgradeService(client, process.env.TOKEN_ID);

        const result = await upgradeService.updateRoyalties(royaltyStructure);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/upgrade/pause', async (req, res) => {
    try {
        const { adminPassword } = req.body;

        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        const client = Client.forTestnet();
        client.setOperator(process.env.OPERATOR_ID, process.env.OPERATOR_KEY);
        const upgradeService = new UpgradeService(client, process.env.TOKEN_ID);

        const result = await upgradeService.pauseToken();
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/upgrade/unpause', async (req, res) => {
    try {
        const { adminPassword } = req.body;

        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        const client = Client.forTestnet();
        client.setOperator(process.env.OPERATOR_ID, process.env.OPERATOR_KEY);
        const upgradeService = new UpgradeService(client, process.env.TOKEN_ID);

        const result = await upgradeService.unpauseToken();
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SERVER STARTUP ====================

const PORT = process.env.PORT || 3000;

async function startServer() {
    // Check if we have a token ID, if not, show deployment instructions
    if (!process.env.TOKEN_ID) {
        console.log("\n⚠️  NFT COLLECTION NOT DEPLOYED");
        console.log("========================================");
        console.log("To deploy your NFT collection, use:");
        console.log("POST /api/deploy with adminPassword");
        console.log("OR");
        console.log("POST /api/deploy/auto with adminPassword");
        console.log("\nMake sure your .env has OPERATOR_ID and OPERATOR_KEY");
        console.log("========================================\n");
    } else {
        console.log(`📊 NFT Collection: ${process.env.TOKEN_ID}`);
    }

    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`\n📋 Available Endpoints:`);
        console.log(`   POST /api/mint/initiate - Start minting process`);
        console.log(`   POST /api/mint/complete - Complete minting after payment`);
        console.log(`   GET  /api/mint/status/:paymentId - Check payment status`);
        console.log(`   GET  /api/mint/stats - Get minting statistics`);
        console.log(`   GET  /api/mint/pricing - Get tier pricing`);
        console.log(`   GET  /api/mint/test - Test API connection`);
        console.log(`   POST /api/deploy - Deploy NFT collection`);
        console.log(`   GET  /api/deploy/status - Check deployment status`);
        console.log(`   POST /api/airdrop - Distribute airdrops\n`);

        // Initialize and show rarity stats if token is deployed
        if (process.env.TOKEN_ID) {
            const MintService = require('./services/mint-service');
            const mintService = new MintService();
            setTimeout(() => {
                mintService.tierService.printStatus();
                mintService.close();
            }, 1000);
        }
    });
}

startServer().catch(console.error);