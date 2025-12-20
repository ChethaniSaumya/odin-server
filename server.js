const express = require('express');
const cors = require('cors');
require("dotenv").config();
const fs = require('fs');
const path = require('path');

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
app.use(express.json());
const priceService = require('./services/price-service');
const mintRecorder = require('./services/mint-recorder');
const { updateFileOnGitHub } = require('./services/githubHelper');
const githubSyncService = require('./services/github-sync-service');

const claimedFile = path.join(__dirname, 'data', 'claimed-wallets.json');
const githubClaimedPath = 'data/claimed-wallets.json'; // Path in your GitHub repo
app.use(cors({
    origin: ['https://odin-frontend-virid.vercel.app', 'https://min.theninerealms.world', 'https://mint.theninerealms.world'],
    methods: ['GET', 'POST'],
    credentials: true
}));

/**
 * Check if an account is associated with our NFT token
 * @param {string} accountId - Hedera account ID (e.g., "0.0.12345")
 * @returns {Promise<boolean>} - true if associated, false otherwise
 */
async function checkTokenAssociation(accountId) {
    try {
        const tokenId = process.env.TOKEN_ID;
        const mirrorNodeUrl = process.env.NETWORK === 'testnet'
            ? 'https://testnet.mirrornode.hedera.com'
            : 'https://testnet.mirrornode.hedera.com';

        const url = `${mirrorNodeUrl}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`;

        console.log(`🔍 Checking token association for ${accountId}...`);

        const response = await fetch(url);

        if (!response.ok) {
            console.error(`❌ Mirror node error: ${response.status}`);
            return false;
        }

        const data = await response.json();
        const isAssociated = data.tokens && data.tokens.length > 0;

        console.log(`   Association status: ${isAssociated ? '✅ Associated' : '❌ Not Associated'}`);

        return isAssociated;

    } catch (error) {
        console.error(`❌ Failed to check token association:`, error.message);
        return false;
    }
}

// ==================== MINT ROUTES ====================

// ==================== MINT RECORDS ENDPOINTS ====================


function loadClaimedWallets() {
    try {
        const data = fs.readFileSync(claimedFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

function saveClaimedWallets(data) {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const content = JSON.stringify(data, null, 2);

    // Save locally
    fs.writeFileSync(claimedFile, content);
    console.log('💾 Claimed wallets saved locally');

    // ✅ SYNC TO GITHUB (async, fire and forget)
    updateFileOnGitHub(
        githubClaimedPath,
        content,
        `Update claimed wallets: ${Object.keys(data).length} claims - ${new Date().toISOString()}`
    ).then(() => {
        console.log('☁️ Claimed wallets synced to GitHub');
    }).catch((error) => {
        console.error('⚠️ GitHub sync for claimed wallets failed:', error.message);
    });
}

/**
 * Check if user wallet is associated with our token
 * GET /api/token/association/:accountId
 */
app.get('/api/token/association/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;

        // Validate account format
        if (!accountId.match(/^\d+\.\d+\.\d+$/)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid account format. Use: 0.0.XXXXX'
            });
        }

        const isAssociated = await checkTokenAssociation(accountId);

        res.json({
            success: true,
            accountId: accountId,
            tokenId: process.env.TOKEN_ID,
            isAssociated: isAssociated,
            message: isAssociated
                ? 'Token is associated with this account'
                : 'Token is NOT associated. User must associate before receiving NFTs.'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Fix minted tracker from mint records
 * POST /api/admin/fix-tracker
 */
app.post('/api/admin/fix-tracker', async (req, res) => {
    try {
        const { adminPassword } = req.body;

        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        console.log('🔧 Fixing minted tracker from mint records...');

        // Get all mint records
        const allRecords = mintRecorder.getAllRecords();

        // Rebuild tracker from records
        const newTracker = {
            common: [],
            rare: [],
            legendary: [],
            legendary_1of1: [],
            nextIndex: {
                common: 0,
                rare: 0,
                legendary: 0,
                legendary_1of1: 0
            }
        };

        // Process each record
        for (const record of allRecords) {
            const rarity = record.rarity;
            const metadataTokenId = record.metadataTokenId;

            if (newTracker[rarity] && !newTracker[rarity].includes(metadataTokenId)) {
                newTracker[rarity].push(metadataTokenId);
            }
        }

        // Update nextIndex based on minted count
        newTracker.nextIndex.common = newTracker.common.length;
        newTracker.nextIndex.rare = newTracker.rare.length;
        newTracker.nextIndex.legendary = newTracker.legendary.length;
        newTracker.nextIndex.legendary_1of1 = newTracker.legendary_1of1.length;

        console.log('📊 Rebuilt tracker:', newTracker);

        // Save to file
        const trackerFile = path.join(__dirname, 'services', 'data', 'minted-tracker.json');
        const dataDir = path.join(__dirname, 'services', 'data');

        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const content = JSON.stringify(newTracker, null, 2);
        fs.writeFileSync(trackerFile, content);

        // Sync to GitHub
        try {
            await updateFileOnGitHub(
                'services/data/minted-tracker.json',
                content,
                `Fix minted tracker: ${new Date().toISOString()}`
            );
            console.log('☁️ Fixed tracker synced to GitHub');
        } catch (githubError) {
            console.error('⚠️ GitHub sync failed:', githubError.message);
        }

        res.json({
            success: true,
            message: 'Tracker fixed successfully',
            newTracker: newTracker,
            recordsProcessed: allRecords.length
        });

    } catch (error) {
        console.error('Fix tracker error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Check if user has already claimed
 * GET /api/airdrop/claim-status/:accountId
 */
app.get('/api/airdrop/claim-status/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const claimedWallets = loadClaimedWallets();

        res.json({
            success: true,
            accountId: accountId,
            hasClaimed: !!claimedWallets[accountId],
            claimedAt: claimedWallets[accountId]?.claimedAt || null,
            tier: claimedWallets[accountId]?.tier || null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/airdrop/claim', async (req, res) => {
    console.log('\n🎁 CLAIM AIRDROP');

    let mintService = null;

    try {
        const { userAccountId, tier } = req.body;

        // Validate inputs
        if (!userAccountId || !tier) {
            return res.status(400).json({
                success: false,
                error: 'Missing userAccountId or tier'
            });
        }

        // Validate account format
        if (!userAccountId.match(/^\d+\.\d+\.\d+$/)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid account format. Use: 0.0.XXXXX'
            });
        }

        // ✅ STEP 1: Check if already claimed
        const claimedWallets = loadClaimedWallets();
        if (claimedWallets[userAccountId]) {
            return res.status(400).json({
                success: false,
                error: 'Already claimed',
                claimedAt: claimedWallets[userAccountId].claimedAt
            });
        }

        // ✅ STEP 2: CHECK TOKEN ASSOCIATION BEFORE MINTING
        console.log(`🔍 Checking token association for ${userAccountId}...`);
        const isAssociated = await checkTokenAssociation(userAccountId);

        if (!isAssociated) {
            console.log(`❌ User ${userAccountId} has not associated with token ${process.env.TOKEN_ID}`);
            return res.status(400).json({
                success: false,
                error: 'Token not associated',
                message: `Please associate your wallet with token ${process.env.TOKEN_ID} before claiming. You can do this in HashPack or your Hedera wallet.`,
                tokenId: process.env.TOKEN_ID,
                requiresAssociation: true
            });
        }

        console.log(`✅ Token association confirmed for ${userAccountId}`);

        // ✅ STEP 3: Determine NFTs to mint based on tier
        const nftsToMint = [];
        if (tier === 'tier1') {
            nftsToMint.push('common');
        } else if (tier === 'tier2') {
            nftsToMint.push('common', 'rare');
        } else if (tier === 'tier3') {
            nftsToMint.push('common', 'rare', 'legendary');
        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid tier. Must be: tier1, tier2, or tier3'
            });
        }

        console.log(`📦 Minting: ${nftsToMint.join(', ')} for ${userAccountId}`);

        // ✅ STEP 4: Mint NFTs
        mintService = new MintService();
        const mintedNFTs = [];
        const failedMints = [];
        const odinAllocations = { common: 40000, rare: 300000, legendary: 1000000 };

        for (const rarity of nftsToMint) {
            console.log(`\n🎨 Minting ${rarity}...`);

            try {
                const result = await mintService.mintByRarity(userAccountId, rarity, 1);

                mintedNFTs.push({
                    rarity: rarity,
                    tokenId: result.tokens ? result.tokens[0] : result.metadataTokenId,
                    serialNumber: result.serialNumbers ? result.serialNumbers[0] : result.serialNumber,
                    transactionId: result.transactionId
                });

                console.log(`✅ ${rarity} minted: Serial #${result.serialNumbers ? result.serialNumbers[0] : result.serialNumber}`);

                // ✅ RECORD THE AIRDROP MINT
                try {
                    await mintRecorder.recordMint({
                        serialNumber: result.serialNumbers ? result.serialNumbers[0] : result.serialNumber,
                        metadataTokenId: result.tokens ? result.tokens[0] : result.metadataTokenId,
                        tokenId: process.env.TOKEN_ID,
                        rarity: rarity,
                        odinAllocation: odinAllocations[rarity],
                        owner: userAccountId,
                        userAccountId: userAccountId,
                        transactionId: result.transactionId,
                        paymentTransactionHash: null,
                        paidAmount: 0,
                        paidCurrency: 'AIRDROP',
                        hbarUsdRate: 0,
                        metadataUrl: result.metadataUrls ? result.metadataUrls[0] : result.metadataUrl,
                        mintedAt: new Date().toISOString(),
                        isAirdrop: true
                    });
                    console.log(`📝 Recorded airdrop mint for Serial #${result.serialNumbers ? result.serialNumbers[0] : result.serialNumber}`);
                } catch (recordError) {
                    console.error(`⚠️ Failed to record airdrop:`, recordError.message);
                }

            } catch (mintError) {
                console.error(`❌ ${rarity} failed:`, mintError.message);
                failedMints.push({
                    rarity: rarity,
                    error: mintError.message
                });
                // Don't continue if a mint fails - stop the process
                break;
            }
        }

        mintService.close();
        mintService = null;

        // ✅ STEP 5: Handle results
        if (mintedNFTs.length === 0) {
            // All mints failed
            return res.status(500).json({
                success: false,
                error: 'All mints failed',
                details: failedMints
            });
        }

        // ✅ STEP 6: Mark as claimed (even if partial success)
        claimedWallets[userAccountId] = {
            tier: tier,
            claimedAt: new Date().toISOString(),
            nfts: mintedNFTs,
            failedMints: failedMints.length > 0 ? failedMints : undefined
        };
        saveClaimedWallets(claimedWallets);

        // ✅ STEP 7: Return response
        if (mintedNFTs.length === nftsToMint.length) {
            // Full success
            res.json({
                success: true,
                message: `Successfully claimed ${mintedNFTs.length} NFT(s)!`,
                nfts: mintedNFTs
            });
        } else {
            // Partial success
            res.json({
                success: true,
                message: `Partially claimed ${mintedNFTs.length}/${nftsToMint.length} NFTs`,
                nfts: mintedNFTs,
                warning: 'Some NFTs failed to mint',
                failedMints: failedMints
            });
        }

    } catch (error) {
        console.error('❌ Claim error:', error);

        if (mintService) {
            try { mintService.close(); } catch (e) { }
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Verify GitHub consistency
 * GET /api/admin/verify-github
 */
app.get('/api/admin/verify-github', async (req, res) => {
    try {
        const { adminPassword } = req.query;
        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        console.log('🔍 Verifying GitHub consistency...');

        // 1. Check mint records vs GitHub tracker
        const allRecords = mintRecorder.getAllRecords();
        const mintService = new MintService();
        const tierService = mintService.tierService;

        const recordTokenIds = {
            common: [],
            rare: [],
            legendary: [],
            legendary_1of1: []
        };

        // Get all token IDs from mint records
        for (const record of allRecords) {
            const rarity = record.rarity;
            const tokenId = record.metadataTokenId;
            if (recordTokenIds[rarity] && !recordTokenIds[rarity].includes(tokenId)) {
                recordTokenIds[rarity].push(tokenId);
            }
        }

        // Compare with GitHub tracker
        const discrepancies = {};
        for (const tier of ['common', 'rare', 'legendary', 'legendary_1of1']) {
            const inRecords = recordTokenIds[tier].sort((a, b) => a - b);
            const inGitHub = tierService.mintedTracker[tier].sort((a, b) => a - b);

            const missingInGitHub = inRecords.filter(id => !inGitHub.includes(id));
            const extraInGitHub = inGitHub.filter(id => !inRecords.includes(id));

            if (missingInGitHub.length > 0 || extraInGitHub.length > 0) {
                discrepancies[tier] = {
                    missingInGitHub,
                    extraInGitHub,
                    recordCount: inRecords.length,
                    githubCount: inGitHub.length
                };
            }
        }

        mintService.close();

        const hasIssues = Object.keys(discrepancies).length > 0;

        res.json({
            success: true,
            consistent: !hasIssues,
            discrepancies: hasIssues ? discrepancies : null,
            summary: {
                totalMints: allRecords.length,
                mintRecordsByTier: Object.keys(recordTokenIds).reduce((acc, tier) => {
                    acc[tier] = recordTokenIds[tier].length;
                    return acc;
                }, {}),
                message: hasIssues ? 'Run /api/admin/fix-github' : 'GitHub is consistent'
            }
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Fix GitHub inconsistencies
 * POST /api/admin/fix-github
 */
app.post('/api/admin/fix-github', async (req, res) => {
    try {
        const { adminPassword } = req.body;
        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        console.log('🔧 Fixing GitHub inconsistencies...');

        // Get all mint records (source of truth)
        const allRecords = mintRecorder.getAllRecords();

        // Build correct state from mint records
        const correctState = {
            common: [],
            rare: [],
            legendary: [],
            legendary_1of1: [],
            nextIndex: { common: 0, rare: 0, legendary: 0, legendary_1of1: 0 }
        };

        for (const record of allRecords) {
            const rarity = record.rarity;
            const tokenId = record.metadataTokenId;

            if (correctState[rarity] && !correctState[rarity].includes(tokenId)) {
                correctState[rarity].push(tokenId);
            }
        }

        // Sort and calculate nextIndex
        const mintService = new MintService();
        for (const tier of ['common', 'rare', 'legendary', 'legendary_1of1']) {
            correctState[tier].sort((a, b) => a - b);
            if (correctState[tier].length > 0) {
                const maxToken = correctState[tier][correctState[tier].length - 1];
                const index = mintService.tierService.rarityMapping[tier].indexOf(maxToken);
                correctState.nextIndex[tier] = index + 1;
            }
        }

        // Update GitHub
        mintService.tierService.mintedTracker = correctState;
        mintService.tierService.saveMintedTrackerSync();

        mintService.close();

        console.log('✅ GitHub fixed');

        res.json({
            success: true,
            message: 'GitHub fixed from mint records',
            newState: correctState,
            recordsUsed: allRecords.length
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get all claimed wallets (admin)
 * GET /api/airdrop/claimed-list
 */
app.get('/api/airdrop/claimed-list', async (req, res) => {
    try {
        const { adminPassword } = req.query;

        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        const claimedWallets = loadClaimedWallets();
        const entries = Object.entries(claimedWallets);

        res.json({
            success: true,
            totalClaimed: entries.length,
            claims: entries.map(([wallet, data]) => ({
                wallet,
                ...data
            }))
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get all mint records
 * GET /api/mint/records
 */
app.get('/api/mint/records', async (req, res) => {
    try {
        const records = mintRecorder.getAllRecords();
        const stats = mintRecorder.getStatistics();

        res.json({
            success: true,
            total: records.length,
            statistics: stats,
            records: records
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Debug: Check if metadata IDs are being assigned correctly
 * GET /api/debug/next-tokens/:rarity
 */
app.get('/api/debug/next-tokens/:rarity', async (req, res) => {
    try {
        const { rarity } = req.params;
        const { adminPassword } = req.query;

        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        const mintService = new MintService();
        const tierService = mintService.tierService;

        // Get current state
        const stats = tierService.getTierStats();
        const nextIndex = tierService.mintedTracker.nextIndex[rarity] || 0;
        const allTokens = tierService.rarityMapping[rarity] || [];

        // Preview next 5 tokens
        const next5 = allTokens.slice(nextIndex, nextIndex + 5);

        mintService.close();

        res.json({
            success: true,
            rarity: rarity,
            nextIndex: nextIndex,
            totalAvailable: stats[rarity].available,
            totalMinted: stats[rarity].minted,
            next5Tokens: next5,
            allTokensCount: allTokens.length
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Verify mint tracking consistency
 * GET /api/debug/verify-tracking
 */
app.get('/api/debug/verify-tracking', async (req, res) => {
    try {
        const { adminPassword } = req.query;

        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        const mintService = new MintService();
        const tierService = mintService.tierService;

        // Get tracking data
        const mintedTracker = tierService.mintedTracker;
        const stats = tierService.getTierStats();

        // Get mint records
        const allRecords = mintRecorder.getAllRecords();
        const recordsByRarity = {
            common: allRecords.filter(r => r.rarity === 'common'),
            rare: allRecords.filter(r => r.rarity === 'rare'),
            legendary: allRecords.filter(r => r.rarity === 'legendary')
        };

        // Compare
        const comparison = {
            common: {
                trackerSays: stats.common.minted,
                recordsSay: recordsByRarity.common.length,
                match: stats.common.minted === recordsByRarity.common.length
            },
            rare: {
                trackerSays: stats.rare.minted,
                recordsSay: recordsByRarity.rare.length,
                match: stats.rare.minted === recordsByRarity.rare.length
            },
            legendary: {
                trackerSays: stats.legendary.minted,
                recordsSay: recordsByRarity.legendary.length,
                match: stats.legendary.minted === recordsByRarity.legendary.length
            }
        };

        mintService.close();

        res.json({
            success: true,
            allMatch: comparison.common.match && comparison.rare.match && comparison.legendary.match,
            comparison: comparison,
            nextIndexes: mintedTracker.nextIndex
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Check mint lock status
 * GET /api/debug/mint-lock-status
 */
app.get('/api/debug/mint-lock-status', async (req, res) => {
    try {
        const { adminPassword } = req.query;

        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        const mintService = new MintService();
        const tierService = mintService.tierService;

        const lockDuration = tierService.lockAcquiredAt
            ? Date.now() - new Date(tierService.lockAcquiredAt).getTime()
            : 0;

        res.json({
            success: true,
            isLocked: tierService.mintLock,
            lockedSince: tierService.lockAcquiredAt,
            lockDurationMs: lockDuration,
            lockDurationSeconds: Math.floor(lockDuration / 1000),
            status: tierService.mintLock
                ? `🔒 Locked for ${Math.floor(lockDuration / 1000)}s`
                : '🔓 Available'
        });

        mintService.close();

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get mint records by rarity
 * GET /api/mint/records/rarity/:rarity
 */
app.get('/api/mint/records/rarity/:rarity', async (req, res) => {
    try {
        const { rarity } = req.params;
        const records = mintRecorder.getRecordsByRarity(rarity);

        res.json({
            success: true,
            rarity: rarity,
            total: records.length,
            records: records
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get mint records by owner
 * GET /api/mint/records/owner/:accountId
 */
app.get('/api/mint/records/owner/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const records = mintRecorder.getRecordsByOwner(accountId);

        res.json({
            success: true,
            owner: accountId,
            total: records.length,
            totalOdinAllocated: records.reduce((sum, r) => sum + r.odinAllocation, 0),
            records: records
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get mint statistics
 * GET /api/mint/records/statistics
 */
app.get('/api/mint/records/statistics', async (req, res) => {
    try {
        const stats = mintRecorder.getStatistics();

        res.json({
            success: true,
            statistics: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Export mint records to CSV
 * GET /api/mint/records/export/csv
 */
app.get('/api/mint/records/export/csv', async (req, res) => {
    try {
        const csvFile = await mintRecorder.exportToCSV();

        if (!csvFile) {
            return res.status(404).json({
                success: false,
                error: 'No records to export'
            });
        }

        res.download(csvFile, 'mint-records.csv');
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Search mint records
 * POST /api/mint/records/search
 * Body: { rarity: "common", ownerAccountId: "0.0.1234" }
 */
app.post('/api/mint/records/search', async (req, res) => {
    try {
        const criteria = req.body;
        const records = mintRecorder.searchRecords(criteria);

        res.json({
            success: true,
            criteria: criteria,
            total: records.length,
            records: records
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get specific mint record by serial number
 * GET /api/mint/records/serial/:serialNumber
 */
app.get('/api/mint/records/serial/:serialNumber', async (req, res) => {
    try {
        const serialNumber = parseInt(req.params.serialNumber);
        const records = mintRecorder.searchRecords({ serialNumber });

        if (records.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Record not found'
            });
        }

        res.json({
            success: true,
            record: records[0]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

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

app.post('/api/mint/verify-and-mint', async (req, res) => {
    console.log('\n🎯 VERIFY & MINT ENDPOINT CALLED');
    console.log('================================================');

    let mintService = null;
    let mintResults = [];
    let transactionMarkedUsed = false;

    try {
        const { userAccountId, rarity, quantity, transactionHash } = req.body;

        console.log('📥 Request:', { userAccountId, rarity, quantity, transactionHash });

        // Validate required parameters
        if (!userAccountId || !rarity || !quantity || !transactionHash) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: userAccountId, rarity, quantity, transactionHash'
            });
        }

        if (!['common', 'rare', 'legendary'].includes(rarity)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid rarity. Must be: common, rare, or legendary'
            });
        }

        // ✅ SAFETY CHECK: Verify token association (should already be done on frontend)
        console.log('🔍 SAFETY CHECK: Verifying token association...');
        const isAssociated = await checkTokenAssociation(userAccountId);

        if (!isAssociated) {
            console.log(`❌ CRITICAL: User ${userAccountId} paid but token not associated!`);

            // Mark transaction as used to prevent retry attempts
            const usedTxFile = path.join(__dirname, 'data', 'used-transactions.json');
            let usedTransactions = {};
            try {
                const data = fs.readFileSync(usedTxFile, 'utf8');
                usedTransactions = JSON.parse(data);
            } catch (e) {
                usedTransactions = {};
            }

            usedTransactions[transactionHash] = {
                userAccountId,
                rarity,
                quantity,
                timestamp: new Date().toISOString(),
                status: 'failed_no_association',
                error: 'Token not associated - user needs to associate and contact support for refund or retry'
            };

            const dataDir = path.join(__dirname, 'data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(usedTxFile, JSON.stringify(usedTransactions, null, 2));

            return res.status(400).json({
                success: false,
                error: 'Token not associated - REFUND REQUIRED',
                message: `Critical error: Payment received but token ${process.env.TOKEN_ID} is not associated with your wallet.\n\nPlease:\n1. Associate your wallet with token ${process.env.TOKEN_ID}\n2. Contact support for assistance\n\nYour transaction: ${transactionHash}`,
                tokenId: process.env.TOKEN_ID,
                requiresAssociation: true,
                refundRequired: true,
                transactionHash: transactionHash,
                supportContact: process.env.SUPPORT_EMAIL || 'support@theninerealms.world'
            });
        }

        console.log('✅ Token association confirmed (safety check passed)');

        const treasuryId = process.env.TREASURY_ACCOUNT_ID || process.env.OPERATOR_ID;

        // Normalize transaction ID
        const normalizeTransactionId = (txId) => {
            if (txId.includes('@')) {
                const parts = txId.split('@');
                const accountId = parts[0];
                const rest = parts[1].split('.');
                return `${accountId}-${rest[0]}-${rest[1]}`;
            }
            return txId;
        };

        const normalizedInputHash = normalizeTransactionId(transactionHash);

        // STEP 1: Check if transaction already used
        console.log('📂 STEP 1: Checking if transaction already used...');

        const usedTxFile = path.join(__dirname, 'data', 'used-transactions.json');
        let usedTransactions = {};

        try {
            const data = fs.readFileSync(usedTxFile, 'utf8');
            usedTransactions = JSON.parse(data);
        } catch (error) {
            usedTransactions = {};
        }

        const alreadyUsed = Object.keys(usedTransactions).some(key =>
            normalizeTransactionId(key) === normalizedInputHash
        );

        if (alreadyUsed) {
            const usedTxData = usedTransactions[transactionHash] || usedTransactions[Object.keys(usedTransactions).find(key => normalizeTransactionId(key) === normalizedInputHash)];

            return res.status(400).json({
                success: false,
                error: 'This payment has already been used to mint an NFT',
                usedAt: usedTxData?.timestamp,
                status: usedTxData?.status
            });
        }

        // STEP 2: Fetch and verify transaction from Mirror Node
        console.log('🔍 STEP 2: Fetching transaction from Mirror Node...');

        let matchingTx = null;
        const maxAttempts = 10;
        const retryDelay = 3000;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const mirrorUrl = `https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=${userAccountId}&transactiontype=CRYPTOTRANSFER&limit=10&order=desc`;
                const mirrorResponse = await fetch(mirrorUrl);

                if (!mirrorResponse.ok) {
                    if (attempt === maxAttempts) {
                        return res.status(500).json({ success: false, error: 'Mirror Node error' });
                    }
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                }

                const mirrorData = await mirrorResponse.json();

                if (!mirrorData.transactions || mirrorData.transactions.length === 0) {
                    if (attempt === maxAttempts) {
                        return res.status(400).json({ success: false, error: 'No transactions found' });
                    }
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                }

                matchingTx = mirrorData.transactions.find(tx =>
                    normalizeTransactionId(tx.transaction_id) === normalizedInputHash
                );

                if (matchingTx) break;

                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            } catch (fetchError) {
                if (attempt === maxAttempts) {
                    return res.status(500).json({ success: false, error: 'Failed to query Mirror Node' });
                }
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }

        if (!matchingTx) {
            return res.status(400).json({
                success: false,
                error: 'Transaction not found in Mirror Node'
            });
        }

        // STEP 3: Verify transaction details
        console.log('✅ STEP 3: Verifying transaction...');

        if (matchingTx.result !== 'SUCCESS') {
            return res.status(400).json({
                success: false,
                error: `Transaction failed with status: ${matchingTx.result}`
            });
        }

        const transfers = matchingTx.transfers || [];
        const treasuryTransfer = transfers.find(t => t.account === treasuryId && t.amount > 0);
        const userTransfer = transfers.find(t => t.account === userAccountId && t.amount < 0);

        if (!treasuryTransfer || !userTransfer) {
            return res.status(400).json({
                success: false,
                error: 'Transaction does not show valid payment'
            });
        }

        const amountSentTinybars = Math.abs(userTransfer.amount);
        const amountSentHbar = amountSentTinybars / 100000000;
        const perNFTCost = amountSentHbar / quantity;

        // Verify price
        const dynamicPricing = await priceService.getDynamicPricing();
        const expectedPriceHbar = dynamicPricing.tiers[rarity].hbarPrice;
        const currentHbarRate = dynamicPricing.hbarUsdPrice;

        const verification = await priceService.verifyPaymentAmount(rarity, perNFTCost, 1);

        if (!verification.isValid) {
            return res.status(400).json({
                success: false,
                error: `Payment amount mismatch. Expected ~${expectedPriceHbar.toFixed(2)} HBAR per NFT, got ${perNFTCost.toFixed(2)} HBAR`,
                expected: expectedPriceHbar,
                received: perNFTCost,
                quantity: quantity
            });
        }

        // STEP 4: Mark transaction as used BEFORE minting
        console.log('💾 STEP 4: Marking transaction as used...');

        usedTransactions[transactionHash] = {
            userAccountId,
            rarity,
            quantity,
            amountHbar: amountSentHbar,
            timestamp: new Date().toISOString(),
            status: 'pending_mint'
        };

        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(usedTxFile, JSON.stringify(usedTransactions, null, 2));
        transactionMarkedUsed = true;

        // STEP 5: MINT THE NFT(s)
        console.log(`🎨 STEP 5: Minting ${quantity} ${rarity} NFT(s)...`);

        mintService = new MintService();
        const tierNames = { common: 'Common', rare: 'Rare', legendary: 'Legendary' };
        const odinAllocations = { common: 40000, rare: 300000, legendary: 1000000 };

        for (let i = 0; i < quantity; i++) {
            console.log(`   [${i + 1}/${quantity}] Minting...`);
            const result = await mintService.mintByRarity(userAccountId, rarity);
            mintResults.push(result);
            console.log(`   [${i + 1}/${quantity}] ✅ Serial #${result.serialNumbers ? result.serialNumbers[0] : result.serialNumber}`);
        }

        mintService.close();
        mintService = null;

        // ✅ MINT SUCCESSFUL - Update transaction status
        usedTransactions[transactionHash].status = 'minted';
        usedTransactions[transactionHash].serialNumbers = mintResults.map(r => r.serialNumbers ? r.serialNumbers[0] : r.serialNumber);
        fs.writeFileSync(usedTxFile, JSON.stringify(usedTransactions, null, 2));

        console.log('🎉 MINTING COMPLETE!');

        // ✅ BUILD RESPONSE IMMEDIATELY
        const successResponse = {
            success: true,
            message: `Successfully minted ${quantity} ${rarity} NFT${quantity > 1 ? 's' : ''}!`,
            nftDetails: mintResults.map(result => ({
                tokenId: process.env.TOKEN_ID,
                serialNumber: result.serialNumbers ? result.serialNumbers[0] : result.serialNumber,
                metadataTokenId: result.tokens ? result.tokens[0] : result.metadataTokenId,
                rarity: rarity,
                tierName: tierNames[rarity],
                odinAllocation: odinAllocations[rarity],
                metadataUrl: result.metadataUrls ? result.metadataUrls[0] : result.metadataUrl,
                transactionId: result.transactionId
            })),
            transactionHash: transactionHash,
            mintedCount: mintResults.length
        };

        // ✅ SEND RESPONSE FIRST
        res.json(successResponse);

        // ✅ RECORD ASYNC (AFTER RESPONSE)
        console.log('📝 Recording mints (async)...');

        setImmediate(async () => {
            for (let i = 0; i < mintResults.length; i++) {
                const result = mintResults[i];
                try {
                    await mintRecorder.recordMint({
                        serialNumber: result.serialNumbers ? result.serialNumbers[0] : result.serialNumber,
                        metadataTokenId: result.tokens ? result.tokens[0] : result.metadataTokenId,
                        tokenId: process.env.TOKEN_ID,
                        rarity: rarity,
                        odinAllocation: odinAllocations[rarity],
                        owner: userAccountId,
                        userAccountId: userAccountId,
                        transactionId: result.transactionId,
                        paymentTransactionHash: transactionHash,
                        paidAmount: amountSentHbar,
                        paidCurrency: 'HBAR',
                        hbarUsdRate: currentHbarRate,
                        metadataUrl: result.metadataUrls ? result.metadataUrls[0] : result.metadataUrl,
                        mintedAt: new Date().toISOString(),
                        isAirdrop: false
                    });
                    console.log(`   ✅ Recorded Serial #${result.serialNumbers ? result.serialNumbers[0] : result.serialNumber}`);
                } catch (recordError) {
                    console.error(`   ❌ Failed to record Serial #${result.serialNumbers ? result.serialNumbers[0] : result.serialNumber}:`, recordError.message);
                }
                if (i < mintResults.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            console.log('✅ All recordings complete');
        });

    } catch (error) {
        console.error('❌ VERIFY & MINT ERROR:', error.message);
        console.error('Stack:', error.stack);

        // Close mint service if open
        if (mintService) {
            try { mintService.close(); } catch (e) { }
        }

        // If minting was successful but we crashed after, still tell user
        if (mintResults.length > 0) {
            return res.status(200).json({
                success: true,
                message: `Minted ${mintResults.length} NFT(s) but had recording error`,
                nftDetails: mintResults.map(result => ({
                    tokenId: process.env.TOKEN_ID,
                    serialNumber: result.serialNumbers ? result.serialNumbers[0] : result.serialNumber,
                    metadataTokenId: result.tokens ? result.tokens[0] : result.metadataTokenId,
                    rarity: req.body.rarity
                })),
                warning: 'Recording may have failed, but your NFTs were minted successfully'
            });
        }

        // If transaction was marked used but minting failed, remove it
        if (transactionMarkedUsed && mintResults.length === 0) {
            try {
                const usedTxFile = path.join(__dirname, 'data', 'used-transactions.json');
                let usedTransactions = JSON.parse(fs.readFileSync(usedTxFile, 'utf8'));
                delete usedTransactions[req.body.transactionHash];
                fs.writeFileSync(usedTxFile, JSON.stringify(usedTransactions, null, 2));
                console.log('   ℹ️ Transaction unmarked (mint failed)');
            } catch (e) { }
        }

        return res.status(500).json({
            success: false,
            error: error.message,
            details: 'Check server logs for more information'
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
                price: 1,//14, // Changed from "14 HBAR" to 14
                //tinybars: new Hbar(14).toTinybars().toString(),
                tinybars: new Hbar(1).toTinybars().toString(),
                odinAllocation: 40000,
                available: mintService.getAvailableByRarity('common')
            },
            rare: {
                price: 2,//72, // Changed from "72 HBAR" to 72
                //tinybars: new Hbar(72).toTinybars().toString(),
                tinybars: new Hbar(2).toTinybars().toString(),
                odinAllocation: 300000,
                available: mintService.getAvailableByRarity('rare')
            },
            legendary: {
                price: 3,//220, // Changed from "220 HBAR" to 220
                //tinybars: new Hbar(220).toTinybars().toString(),
                tinybars: new Hbar(3).toTinybars().toString(),
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
 * Get dynamic pricing based on current HBAR/USD rate
 * GET /api/mint/dynamic-pricing
 */
app.get('/api/mint/dynamic-pricing', async (req, res) => {
    try {
        const mintService = new MintService();
        const dynamicPricing = await priceService.getDynamicPricing();

        // Add availability info
        const pricing = {
            success: true,
            hbarUsdPrice: dynamicPricing.hbarUsdPrice,
            lastUpdated: dynamicPricing.lastUpdated,
            tiers: {
                common: {
                    ...dynamicPricing.tiers.common,
                    available: mintService.getAvailableByRarity('common')
                },
                rare: {
                    ...dynamicPricing.tiers.rare,
                    available: mintService.getAvailableByRarity('rare')
                },
                legendary: {
                    ...dynamicPricing.tiers.legendary,
                    available: mintService.getAvailableByRarity('legendary')
                }
            }
        };

        mintService.close();
        res.json(pricing);

    } catch (error) {
        console.error('Dynamic pricing error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get current HBAR price
 * GET /api/mint/hbar-price
 */
app.get('/api/mint/hbar-price', async (req, res) => {
    try {
        const hbarPrice = await priceService.getCurrentHbarPrice();
        res.json({
            success: true,
            hbarUsdPrice: hbarPrice,
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
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

/*async function deployNFT() {
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
            operatorKey = PrivateKey.fromStringED25519(keyString);
            console.log("✅ ED25519 format successful");
        } catch (e1) {
            // Method 2: Try ECDSA
            try {
                operatorKey = PrivateKey.fromStringECDSA(keyString);
                console.log("✅ ECDSA format successful");
            } catch (e2) {
                // Method 3: Try standard DER
                try {
                    operatorKey = PrivateKey.fromString(keyString);
                    console.log("✅ Standard DER format successful");
                } catch (e3) {
                    console.log("❌ ALL KEY FORMATS FAILED");
                    throw new Error("Cannot parse private key");
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
}*/


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

    // 2. CLIENT CONFIGURATION
    const client = Client.forTestnet();

    try {
        // Parse operator key (handle 0x prefix for raw hex)
        let operatorKey;
        const keyString = process.env.OPERATOR_KEY.trim().replace(/^0x/, '');

        console.log("🔑 Parsing private key...");
        console.log("Key format:", keyString.length === 64 ? "Raw ECDSA" : "DER-encoded");

        try {
            operatorKey = PrivateKey.fromStringECDSA(keyString);
            console.log("✅ ECDSA key parsed");
        } catch (e1) {
            try {
                operatorKey = PrivateKey.fromStringED25519(keyString);
                console.log("✅ ED25519 key parsed");
            } catch (e2) {
                operatorKey = PrivateKey.fromString(keyString);
                console.log("✅ Key parsed (auto-detect)");
            }
        }

        client.setOperator(process.env.OPERATOR_ID, operatorKey);
        console.log("✅ Client configured");
        console.log("📝 Public key:", operatorKey.publicKey.toString().substring(0, 30) + "...\n");

        // 3. GENERATE SUPPLY KEY (use same algorithm as operator key)
        console.log("🔑 Generating supply key...");
        const supplyKey = PrivateKey.generateECDSA(); // Match ECDSA format
        console.log("✅ Supply key generated (ECDSA)\n");

        // 4. CREATE TOKEN - ULTRA SIMPLE VERSION
        console.log("📦 Creating NFT token...");
        console.log("⚙️  Configuration:");
        console.log("   Name: Odin");
        console.log("   Symbol: ODIN");
        console.log("   Type: Non-Fungible Unique");
        console.log("   Treasury:", process.env.OPERATOR_ID);
        console.log("   Supply Key: Generated");
        console.log("");

        const transaction = new TokenCreateTransaction()
            .setTokenName("Odin")
            .setTokenSymbol("ODIN")
            .setTokenType(TokenType.NonFungibleUnique)
            .setDecimals(0)
            .setInitialSupply(0)
            .setTreasuryAccountId(process.env.OPERATOR_ID)
            .setSupplyKey(supplyKey.publicKey)
            .setMaxTransactionFee(new Hbar(30));

        console.log("💰 Max transaction fee: 30 HBAR");
        console.log("⚡ Submitting to network...\n");

        // Execute - operator signature is automatic via client
        const txResponse = await transaction.execute(client);

        console.log("✅ Transaction submitted!");
        console.log("📋 Transaction ID:", txResponse.transactionId.toString());
        console.log("");

        // 5. WAIT FOR RECEIPT
        console.log("⏳ Waiting for network consensus...");

        const receipt = await txResponse.getReceipt(client);

        console.log("✅ Transaction confirmed!");
        console.log("📦 Receipt status:", receipt.status.toString());
        console.log("");

        if (!receipt.tokenId) {
            throw new Error("No token ID in receipt");
        }

        const tokenId = receipt.tokenId;

        // 6. SUCCESS OUTPUT
        console.log("🎉 🎉 🎉 NFT DEPLOYED SUCCESSFULLY! 🎉 🎉 🎉");
        console.log("========================================");
        console.log("📝 TOKEN ID:", tokenId.toString());
        console.log("🔍 HashScan:", `https://hashscan.io/testnet/token/${tokenId.toString()}`);
        console.log("👤 Treasury:", process.env.OPERATOR_ID);
        console.log("🔑 Supply Key:", supplyKey.toString().substring(0, 40) + "...");
        console.log("========================================\n");

        // 7. UPDATE ENVIRONMENT FILE
        console.log("💾 Updating .env file...");

        const fs = require('fs');
        const envContent = `OPERATOR_ID=${process.env.OPERATOR_ID}
OPERATOR_KEY=${process.env.OPERATOR_KEY}
NETWORK=testnet
TOKEN_ID=${tokenId.toString()}
SUPPLY_KEY=${supplyKey.toString()}
TREASURY_ACCOUNT_ID=${process.env.OPERATOR_ID}
PORT=3000
ADMIN_PASSWORD=${process.env.ADMIN_PASSWORD || 'admin123'}
GB_TOKEN=${process.env.GB_TOKEN || ''}
GB_REPO_OWNER=${process.env.GB_REPO_OWNER || ''}
GB_REPO_NAME=${process.env.GB_REPO_NAME || ''}
GB_BRANCH=${process.env.GB_BRANCH || 'main'}`;

        fs.writeFileSync('.env', envContent);
        console.log("✅ Environment variables saved\n");

        return tokenId.toString();

    } catch (error) {
        console.log("\n❌ ❌ ❌ DEPLOYMENT FAILED ❌ ❌ ❌");
        console.log("========================================");
        console.log("Error:", error.message);

        if (error.status) {
            console.log("Status:", error.status.toString());
        }

        if (error.message.includes("INVALID_SIGNATURE")) {
            console.log("\n🔍 Debug Info:");
            console.log("This shouldn't happen since diagnostic passed!");
            console.log("The issue might be in transaction construction.");
        }

        console.log("\nFull error:");
        console.log(error);
        console.log("========================================\n");

        throw error;
    } finally {
        client.close();
    }
}


//module.exports = { deployNFT };


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
 * Emergency fix for tracker issues
 * POST /api/admin/fix-tracker-emergency
 */
app.post('/api/admin/fix-tracker-emergency', async (req, res) => {
    try {
        const { adminPassword } = req.body;

        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        console.log('🚨 EMERGENCY TRACKER FIX');

        // Get all mint records
        const allRecords = mintRecorder.getAllRecords();

        // Create new tracker from mint records
        const newTracker = {
            common: [],
            rare: [],
            legendary: [],
            legendary_1of1: [],
            nextIndex: {
                common: 0,
                rare: 0,
                legendary: 0,
                legendary_1of1: 0
            }
        };

        // Populate from mint records
        for (const record of allRecords) {
            const rarity = record.rarity;
            const tokenId = record.metadataTokenId;

            if (newTracker[rarity] && !newTracker[rarity].includes(tokenId)) {
                newTracker[rarity].push(tokenId);
            }
        }

        // Sort and update nextIndex
        for (const tier in newTracker) {
            if (tier !== 'nextIndex') {
                newTracker[tier].sort((a, b) => a - b);
                newTracker.nextIndex[tier] = newTracker[tier].length;
            }
        }

        // Save to file
        const trackerFile = path.join(__dirname, 'services', 'data', 'minted-tracker.json');
        const dataDir = path.join(__dirname, 'services', 'data');

        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        fs.writeFileSync(trackerFile, JSON.stringify(newTracker, null, 2));

        // Also update the tier service in memory
        const mintService = new MintService();
        mintService.tierService.mintedTracker = newTracker;
        mintService.close();

        console.log('✅ Emergency fix completed');
        console.log('📊 New tracker:', JSON.stringify(newTracker, null, 2));

        res.json({
            success: true,
            message: 'Tracker fixed from mint records',
            newTracker,
            recordsProcessed: allRecords.length
        });

    } catch (error) {
        console.error('Emergency fix error:', error);
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


// ==================== AIRDROP BATCH ENDPOINT ====================

/**
 * Batch Airdrop NFTs to multiple wallets
 * POST /api/airdrop/batch
 * 
 * Body: {
 *   adminPassword: "your_admin_password",
 *   rarity: "common" | "rare" | "legendary",
 *   walletAddresses: ["0.0.12345", "0.0.67890", ...]
 * }
 * 
 * Only accessible by OPERATOR_ID (admin)
 */
app.post('/api/airdrop/batch', async (req, res) => {
    console.log('\n🎁 BATCH AIRDROP ENDPOINT CALLED');
    console.log('================================================');

    try {
        const { adminPassword, rarity, walletAddresses } = req.body;

        // Step 1: Validate admin password
        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            console.log('❌ Unauthorized access attempt');
            return res.status(403).json({
                success: false,
                error: 'Unauthorized. Invalid admin password.'
            });
        }

        console.log('✅ Admin authentication successful');

        // Step 2: Validate required parameters
        if (!rarity || !walletAddresses) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: rarity and walletAddresses are required'
            });
        }

        // Step 3: Validate rarity
        if (!['common', 'rare', 'legendary'].includes(rarity)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid rarity. Must be: common, rare, or legendary'
            });
        }

        // Step 4: Validate wallet addresses array
        if (!Array.isArray(walletAddresses) || walletAddresses.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'walletAddresses must be a non-empty array'
            });
        }

        // Validate each wallet address format
        const invalidAddresses = walletAddresses.filter(addr => !addr.match(/^\d+\.\d+\.\d+$/));
        if (invalidAddresses.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Invalid wallet address format: ${invalidAddresses.join(', ')}. Use format: 0.0.XXXXX`
            });
        }

        console.log('📋 Airdrop Request:');
        console.log(`   Rarity: ${rarity}`);
        console.log(`   Recipients: ${walletAddresses.length}`);
        console.log(`   Addresses: ${walletAddresses.slice(0, 5).join(', ')}${walletAddresses.length > 5 ? '...' : ''}`);
        console.log('================================================\n');

        // Step 5: Check availability
        const mintService = new MintService();
        const tierStats = mintService.tierService.getTierStats();
        const available = tierStats[rarity]?.available || 0;

        if (available < walletAddresses.length) {
            mintService.close();
            return res.status(400).json({
                success: false,
                error: `Not enough ${rarity} NFTs available. Requested: ${walletAddresses.length}, Available: ${available}`
            });
        }

        console.log(`✅ Availability check passed: ${available} ${rarity} NFTs available`);

        // Step 6: Process airdrops
        const results = [];
        const errors = [];
        const tierNames = { common: 'Common', rare: 'Rare', legendary: 'Legendary' };
        const odinAllocations = { common: 40000, rare: 300000, legendary: 1000000 };

        for (let i = 0; i < walletAddresses.length; i++) {
            const walletAddress = walletAddresses[i];
            console.log(`\n[${i + 1}/${walletAddresses.length}] 🎨 Minting ${rarity} NFT to ${walletAddress}...`);

            try {
                // Mint the NFT using mintByRarity (same as regular minting)
                const mintResult = await mintService.mintByRarity(walletAddress, rarity);

                console.log(`   ✅ Minted - Serial: #${mintResult.serialNumber}, Metadata ID: ${mintResult.metadataTokenId}`);

                // Record to mint-recorder (same as regular minting endpoint)
                try {
                    await mintRecorder.recordMint({
                        serialNumber: mintResult.serialNumber,
                        metadataTokenId: mintResult.metadataTokenId,
                        tokenId: process.env.TOKEN_ID,
                        rarity: rarity,
                        odinAllocation: odinAllocations[rarity],
                        owner: walletAddress,
                        userAccountId: walletAddress,
                        transactionId: mintResult.transactionId,
                        paymentTransactionHash: null, // No payment for airdrops
                        paidAmount: 0,
                        paidCurrency: 'AIRDROP',
                        hbarUsdRate: 0,
                        metadataUrl: mintResult.metadataUrl,
                        metadataGatewayUrl: mintResult.metadataUrl || `https://min.theninerealms.world/metadata-odin/${mintResult.metadataTokenId}.json`,
                        mintedAt: new Date().toISOString(),
                        isAirdrop: true
                    });
                    console.log(`   📝 Recorded mint for Serial #${mintResult.serialNumber}`);
                } catch (recordError) {
                    console.error(`   ⚠️ Failed to record mint:`, recordError.message);
                    // Continue even if recording fails
                }

                results.push({
                    walletAddress: walletAddress,
                    success: true,
                    serialNumber: mintResult.serialNumber,
                    metadataTokenId: mintResult.metadataTokenId,
                    tokenId: process.env.TOKEN_ID,
                    rarity: rarity,
                    tierName: tierNames[rarity],
                    odinAllocation: odinAllocations[rarity],
                    transactionId: mintResult.transactionId,
                    metadataUrl: mintResult.metadataUrl
                });

            } catch (mintError) {
                console.error(`   ❌ Failed to mint for ${walletAddress}:`, mintError.message);
                errors.push({
                    walletAddress: walletAddress,
                    success: false,
                    error: mintError.message
                });
            }

            // Small delay between mints to avoid rate limiting
            if (i < walletAddresses.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        mintService.close();

        // Step 7: Generate summary
        const summary = {
            totalRequested: walletAddresses.length,
            successful: results.length,
            failed: errors.length,
            rarity: rarity,
            tierName: tierNames[rarity],
            odinPerNFT: odinAllocations[rarity],
            totalOdinDistributed: results.length * odinAllocations[rarity]
        };

        console.log('\n================================================');
        console.log('🎉 BATCH AIRDROP COMPLETE!');
        console.log('================================================');
        console.log(`   Total Requested: ${summary.totalRequested}`);
        console.log(`   Successful: ${summary.successful}`);
        console.log(`   Failed: ${summary.failed}`);
        console.log(`   Rarity: ${summary.tierName}`);
        console.log(`   Total ODIN Distributed: ${summary.totalOdinDistributed.toLocaleString()}`);
        console.log('================================================\n');

        return res.json({
            success: true,
            message: `Batch airdrop completed. ${summary.successful}/${summary.totalRequested} NFTs minted successfully.`,
            summary: summary,
            results: results,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        console.error('❌ BATCH AIRDROP ERROR:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * Preview Airdrop (Dry Run)
 * POST /api/airdrop/preview
 * 
 * Returns what would be minted without actually minting
 */
app.post('/api/airdrop/preview', async (req, res) => {
    try {
        const { adminPassword, rarity, walletAddresses } = req.body;

        // Validate admin password
        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({
                success: false,
                error: 'Unauthorized. Invalid admin password.'
            });
        }

        // Validate parameters
        if (!rarity || !walletAddresses) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: rarity and walletAddresses'
            });
        }

        if (!['common', 'rare', 'legendary'].includes(rarity)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid rarity. Must be: common, rare, or legendary'
            });
        }

        if (!Array.isArray(walletAddresses) || walletAddresses.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'walletAddresses must be a non-empty array'
            });
        }

        // Check availability
        const mintService = new MintService();
        const tierStats = mintService.tierService.getTierStats();
        const available = tierStats[rarity]?.available || 0;
        mintService.close();

        const odinAllocations = { common: 40000, rare: 300000, legendary: 1000000 };
        const tierNames = { common: 'Common', rare: 'Rare', legendary: 'Legendary' };

        const canComplete = available >= walletAddresses.length;

        res.json({
            success: true,
            preview: {
                rarity: rarity,
                tierName: tierNames[rarity],
                requestedCount: walletAddresses.length,
                availableCount: available,
                canComplete: canComplete,
                odinPerNFT: odinAllocations[rarity],
                totalOdinToDistribute: walletAddresses.length * odinAllocations[rarity],
                walletAddresses: walletAddresses,
                warning: !canComplete ? `Not enough NFTs available. Need ${walletAddresses.length}, have ${available}` : null
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get Airdrop History
 * GET /api/airdrop/history
 * 
 * Returns all airdropped NFTs from mint records
 */
app.get('/api/airdrop/history', async (req, res) => {
    try {
        const { adminPassword } = req.query;

        // Validate admin password
        if (adminPassword !== process.env.ADMIN_PASSWORD) {
            return res.status(403).json({
                success: false,
                error: 'Unauthorized. Invalid admin password.'
            });
        }

        const allRecords = mintRecorder.getAllRecords();
        const airdropRecords = allRecords.filter(r => r.isAirdrop === true);

        // Group by rarity
        const byRarity = {
            common: airdropRecords.filter(r => r.rarity === 'common'),
            rare: airdropRecords.filter(r => r.rarity === 'rare'),
            legendary: airdropRecords.filter(r => r.rarity === 'legendary')
        };

        res.json({
            success: true,
            totalAirdrops: airdropRecords.length,
            byRarity: {
                common: byRarity.common.length,
                rare: byRarity.rare.length,
                legendary: byRarity.legendary.length
            },
            totalOdinDistributed: airdropRecords.reduce((sum, r) => sum + (r.odinAllocation || 0), 0),
            records: airdropRecords
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
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
