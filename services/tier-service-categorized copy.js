const fs = require('fs').promises;
const path = require('path');
require("dotenv").config();

class TierServiceCategorized {
    constructor() {
        this.categorizationFile = path.join(__dirname, 'rarity-categorization.json');
        this.mintedTrackerFile = path.join(__dirname, 'data', 'minted-tracker.json');

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
            const fs = require('fs');
            const dataDir = path.join(__dirname, 'data');

            // Create directory if it doesn't exist
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            fs.writeFileSync(this.mintedTrackerFile, JSON.stringify(this.mintedTracker, null, 2));
            console.log('💾 Minted tracker saved');
        } catch (error) {
            console.error('Error saving minted tracker:', error.message);
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
            await fs.writeFile(this.mintedTrackerFile, JSON.stringify(this.mintedTracker, null, 2));
            console.log('💾 Minted tracker saved (async)');
        } catch (error) {
            console.error('Error saving minted tracker:', error.message);
        }
    }

    /**
     * Get next available token ID for a tier
     */
    async getNextTokenId(tier, quantity = 1) {
        const tierKey = tier.toLowerCase();

        if (!this.rarityMapping[tierKey]) {
            throw new Error(`Invalid tier: ${tier}`);
        }

        let startIndex = this.mintedTracker.nextIndex[tierKey] || 0;
        const availableTokens = this.rarityMapping[tierKey];

        if (startIndex + quantity > availableTokens.length) {
            throw new Error(`Not enough ${tier} tokens available`);
        }

        // FIX: Get the actual token IDs
        const metadataTokenIds = [];
        for (let i = 0; i < quantity; i++) {
            metadataTokenIds.push(availableTokens[startIndex + i]);
        }

        console.log(`🎯 Next ${quantity} ${tier} token(s):`, metadataTokenIds);

        // ✅ INCREMENT nextIndex so next mint gets different tokens
        this.mintedTracker.nextIndex[tierKey] = startIndex + quantity;

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

    /**
     * Mark tokens as successfully minted
     */
    async markAsMinted(tier, tokenIds) {
        const tierKey = tier.toLowerCase();

        if (!Array.isArray(tokenIds)) {
            tokenIds = [tokenIds];
        }

        // Add to minted list
        this.mintedTracker[tierKey].push(...tokenIds);

        // Save to file
        await this.saveMintedTracker();

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