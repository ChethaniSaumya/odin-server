const fs = require('fs').promises;
const path = require('path');
require("dotenv").config();
const { updateFileOnGitHub } = require('./githubHelper');

class TierServiceCategorized {
    constructor() {
        this.categorizationFile = path.join(__dirname, 'rarity-categorization.json');
        this.mintedTrackerFile = path.join(__dirname, 'data', 'minted-tracker.json');
        this.githubTrackerPath = 'services/data/minted-tracker.json'; // Adjust to your repo structure

        // Load categorization data
        this.rarityMapping = {
            common: [],
            rare: [],
            legendary: [],
            legendary_1of1: []
        };

        this.mintedTracker = {
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

        // ✅ Load synchronously in constructor
        this.loadAllDataSync();
        console.log('✅ TierServiceCategorized initialized');

        this.mintLock = false;
        this.lockAcquiredAt = null;  // ⬅️ NEW LINE
    }

    /**
     * Thread-safe wrapper with timeout protection
     */
    async getNextTokenIdSafe(tier, quantity = 1) {
        const startTime = Date.now();
        const maxWaitTime = 30000; // 30 seconds max wait

        // Wait if another mint is in progress (with timeout)
        while (this.mintLock) {
            const elapsed = Date.now() - startTime;

            // Check if we've waited too long
            if (elapsed > maxWaitTime) {
                console.error(`⏰ Mint lock timeout after ${elapsed}ms`);
                console.error(`   Lock was acquired at: ${this.lockAcquiredAt}`);
                console.error(`   Trying to mint: ${tier} x${quantity}`);

                throw new Error(`Mint timeout: System is busy. Please try again in a moment.`);
            }

            // Wait 100ms before checking again
            await new Promise(resolve => setTimeout(resolve, 100));

            // Log every 5 seconds so we know someone is waiting
            if (elapsed % 5000 < 100) {
                console.log(`⏳ Waiting for mint lock... (${Math.floor(elapsed / 1000)}s elapsed)`);
            }
        }

        try {
            // Acquire lock
            this.mintLock = true;
            this.lockAcquiredAt = new Date().toISOString();

            console.log(`🔒 Lock acquired for ${tier} x${quantity} at ${this.lockAcquiredAt}`);

            // Get the next token IDs
            const result = await this.getNextTokenId(tier, quantity);

            console.log(`✅ Token IDs reserved, lock will be released`);

            return result;

        } catch (error) {
            console.error(`❌ Error while lock held:`, error.message);
            throw error;

        } finally {
            // Always unlock, even if error occurs
            this.mintLock = false;
            this.lockAcquiredAt = null;
            console.log(`🔓 Lock released`);
        }
    }

    loadAllDataSync() {
        try {
            // Load categorization file SYNCHRONOUSLY
            const fs = require('fs');
            const catData = fs.readFileSync(this.categorizationFile, 'utf8');
            const categorization = JSON.parse(catData);

            // Map to our tier names
            this.rarityMapping.common = categorization.Common || [];
            this.rarityMapping.rare = categorization.Rare || [];
            this.rarityMapping.legendary = categorization.Legendary || [];
            this.rarityMapping.legendary_1of1 = categorization["Legendary 1-of-1"] || [];

            console.log('📊 Rarity mapping loaded:');
            console.log(`   Common: ${this.rarityMapping.common.length} tokens`);
            console.log(`   Rare: ${this.rarityMapping.rare.length} tokens`);
            console.log(`   Legendary: ${this.rarityMapping.legendary.length} tokens`);
            console.log(`   Legendary 1-of-1: ${this.rarityMapping.legendary_1of1.length} tokens`);

        } catch (error) {
            console.error('❌ Error loading categorization file:', error.message);
            throw error;
        }

        // Load or create minted tracker SYNCHRONOUSLY
        this.loadMintedTrackerSync();
    }

    loadMintedTrackerSync() {
        try {
            const fs = require('fs');
            const data = fs.readFileSync(this.mintedTrackerFile, 'utf8');
            this.mintedTracker = JSON.parse(data);
            console.log('📊 Minted tracker loaded');
        } catch (error) {
            console.log('ℹ️ No minted tracker found, creating new one');
            this.mintedTracker = {
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
            this.saveMintedTrackerSync();
        }
    }

    saveMintedTrackerSync() {
        try {
            const fsSync = require('fs');
            const dataDir = path.join(__dirname, 'data');

            if (!fsSync.existsSync(dataDir)) {
                fsSync.mkdirSync(dataDir, { recursive: true });
            }

            const content = JSON.stringify(this.mintedTracker, null, 2);
            fsSync.writeFileSync(this.mintedTrackerFile, content);
            console.log('💾 Minted tracker saved locally (sync)');

            // ✅ UPDATE GITHUB (async, fire and forget)
            updateFileOnGitHub(
                this.githubTrackerPath,
                content,
                `Update minted tracker: ${new Date().toISOString()}`
            ).then(() => {
                console.log('☁️ Minted tracker synced to GitHub');
            }).catch((error) => {
                console.error('⚠️ GitHub sync failed:', error.message);
            });

        } catch (error) {
            console.error('Error saving minted tracker:', error.message);
        }
    }


    async updateGitHubAsync(content) {
        try {
            await updateFileOnGitHub(
                this.githubTrackerPath,
                content,
                `Update minted tracker: ${new Date().toISOString()}`
            );
            console.log('☁️ Minted tracker synced to GitHub');
        } catch (error) {
            console.error('⚠️ Failed to sync to GitHub:', error.message);
        }
    }

    /**
     * Load categorization data and minted tracker
     */
    async loadAllData() {
        try {
            // Load categorization file
            const catData = await fs.readFile(this.categorizationFile, 'utf8');
            const categorization = JSON.parse(catData);

            // Map to our tier names
            this.rarityMapping.common = categorization.Common || [];
            this.rarityMapping.rare = categorization.Rare || [];
            this.rarityMapping.legendary = categorization.Legendary || [];
            this.rarityMapping.legendary_1of1 = categorization["Legendary 1-of-1"] || [];

            console.log('📊 Rarity mapping loaded:');
            console.log(`   Common: ${this.rarityMapping.common.length} tokens`);
            console.log(`   Rare: ${this.rarityMapping.rare.length} tokens`);
            console.log(`   Legendary: ${this.rarityMapping.legendary.length} tokens`);
            console.log(`   Legendary 1-of-1: ${this.rarityMapping.legendary_1of1.length} tokens`);

        } catch (error) {
            console.error('❌ Error loading categorization file:', error.message);
            throw error;
        }

        // Load or create minted tracker
        await this.loadMintedTracker();
    }

    /**
     * Load minted tracker from file
     */
    async loadMintedTracker() {
        try {
            const data = await fs.readFile(this.mintedTrackerFile, 'utf8');
            this.mintedTracker = JSON.parse(data);
            console.log('📊 Minted tracker loaded');
        } catch (error) {
            console.log('ℹ️ No minted tracker found, creating new one');
            this.mintedTracker = {
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
            await this.saveMintedTracker();
        }
    }

    /**
     * Save minted tracker to file
     */
    async saveMintedTracker() {
        try {
            const dataDir = path.join(__dirname, 'data');
            await fs.mkdir(dataDir, { recursive: true });

            const content = JSON.stringify(this.mintedTracker, null, 2);

            // Save locally
            await fs.writeFile(this.mintedTrackerFile, content);
            console.log('💾 Minted tracker saved locally (async)');

            // ✅ UPDATE GITHUB
            try {
                await updateFileOnGitHub(
                    this.githubTrackerPath,
                    content,
                    `Update minted tracker: ${new Date().toISOString()}`
                );
                console.log('☁️ Minted tracker synced to GitHub');
            } catch (githubError) {
                console.error('⚠️ GitHub sync failed:', githubError.message);
            }

        } catch (error) {
            console.error('Error saving minted tracker:', error.message);
        }
    }

    async getNextTokenId(tier, quantity = 1) {
        const tierKey = tier.toLowerCase();

        if (!this.rarityMapping[tierKey]) {
            throw new Error(`Invalid tier: ${tier}`);
        }

        // ✅ FIX: Reload tracker to get latest nextIndex
        this.loadMintedTrackerSync();

        let startIndex = this.mintedTracker.nextIndex[tierKey] || 0;
        const availableTokens = this.rarityMapping[tierKey];

        console.log(`🔍 getNextTokenId: tier=${tierKey}, startIndex=${startIndex}, totalTokens=${availableTokens.length}`);

        if (startIndex + quantity > availableTokens.length) {
            throw new Error(`Not enough ${tier} tokens available. Requested: ${quantity}, Available: ${availableTokens.length - startIndex}`);
        }

        const metadataTokenIds = [];
        for (let i = 0; i < quantity; i++) {
            metadataTokenIds.push(availableTokens[startIndex + i]);
        }

        console.log(`🎯 Next ${quantity} ${tier} token(s):`, metadataTokenIds);

        // ✅ FIX: Update nextIndex IMMEDIATELY and save
        this.mintedTracker.nextIndex[tierKey] = startIndex + quantity;
        this.saveMintedTrackerSync();

        return {
            metadataTokenIds: metadataTokenIds,
            startIndex: startIndex
        };
    }

    // Add this method to your TierServiceCategorized class:
    getAvailableTokens(rarity) {
        if (!this.categorized[rarity]) {
            return [];
        }

        // Get all tokens of this rarity
        const allTokens = this.categorized[rarity];

        // Filter out minted ones
        const available = allTokens.filter(tokenId =>
            !this.mintedTokens.has(tokenId)
        );

        // CRITICAL: Ensure numeric sort (1, 2, 3, 4... NOT 1, 10, 100, 2, 20...)
        return available.sort((a, b) => a - b);
    }

    // Update the reserveTokens method:
    reserveTokens(rarity, quantity) {
        const availableTokens = this.getAvailableTokens(rarity);

        // DEBUG: Check what's happening
        console.log(`🔍 reserveTokens(${rarity}, ${quantity}):`, {
            first10Available: availableTokens.slice(0, 10),
            taking: availableTokens.slice(0, quantity),
            totalAvailable: availableTokens.length
        });

        if (availableTokens.length < quantity) {
            throw new Error(`Not enough ${rarity} tokens available`);
        }

        // Reserve the first N tokens
        const tokensToReserve = availableTokens.slice(0, quantity);

        // Mark as reserved
        tokensToReserve.forEach(tokenId => {
            this.reservedTokens.add(tokenId);
        });

        return tokensToReserve;
    }

    async markAsMinted(tier, tokenIds) {
        const tierKey = tier.toLowerCase();

        if (!Array.isArray(tokenIds)) {
            tokenIds = [tokenIds];
        }

        // Reload from disk first to avoid race conditions
        this.loadMintedTrackerSync();

        // Add to minted list (avoid duplicates)
        for (const tokenId of tokenIds) {
            if (!this.mintedTracker[tierKey].includes(tokenId)) {
                this.mintedTracker[tierKey].push(tokenId);
            }
        }

        // ✅ FIX: Update nextIndex to match the minted count
        this.mintedTracker.nextIndex[tierKey] = this.mintedTracker[tierKey].length;

        console.log(`📊 Updated ${tierKey} nextIndex to: ${this.mintedTracker.nextIndex[tierKey]}`);

        // Save to file
        this.saveMintedTrackerSync();

        console.log(`✅ Marked ${tokenIds.length} ${tier} token(s) as minted:`, tokenIds);
    }

    /**
     * Get available count for a tier
     */
    getAvailableCount(tier) {
        const tierKey = tier.toLowerCase();
        if (!this.rarityMapping[tierKey]) return 0;

        const totalTokens = this.rarityMapping[tierKey].length;
        const mintedCount = (this.mintedTracker[tierKey] || []).length;

        return totalTokens - mintedCount;
    }

    /**
     * Get all tokens for a tier
     */
    getTokensByTier(tier) {
        const tierKey = tier.toLowerCase();
        return this.rarityMapping[tierKey] || [];
    }

    /**
     * Get tier statistics
     */
    getTierStats() {
        const stats = {};

        for (const tier in this.rarityMapping) {
            const total = this.rarityMapping[tier].length;
            const minted = (this.mintedTracker[tier] || []).length;
            const available = total - minted;

            stats[tier] = {
                total: total,
                minted: minted,
                available: available,
                percentMinted: total > 0 ? ((minted / total) * 100).toFixed(2) : '0.00'
            };
        }

        return stats;
    }

    /**
     * Get tier for a specific token ID
     */
    getTierForToken(tokenId) {
        for (const [tier, tokens] of Object.entries(this.rarityMapping)) {
            if (tokens.includes(tokenId)) {
                return tier;
            }
        }
        return 'common'; // default
    }

    /**
     * Reset minting (for testing only)
     */
    async resetMinting() {
        this.mintedTracker = {
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

        await this.saveMintedTracker();
        console.log('🔄 Minting tracker reset');
    }

    /**
     * Print current status
     */
    printStatus() {
        const stats = this.getTierStats();

        console.log('\n📊 MINTING STATUS:');
        console.log('═══════════════════════════════════════');

        for (const [tier, data] of Object.entries(stats)) {
            console.log(`${tier.toUpperCase()}:`);
            console.log(`   Total: ${data.total}`);
            console.log(`   Minted: ${data.minted}`);
            console.log(`   Available: ${data.available}`);
            console.log(`   Next available ID: ${this.rarityMapping[tier][this.mintedTracker.nextIndex[tier]] || 'N/A'}`);
            console.log('');
        }

        console.log('═══════════════════════════════════════\n');
    }
}

module.exports = TierServiceCategorized;