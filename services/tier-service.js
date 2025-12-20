const fs = require('fs').promises;
const path = require('path');
require("dotenv").config();

class TierService {
    constructor() {
        this.metadataDir = path.join(__dirname, '..', 'metadata');
        this.cacheFile = path.join(__dirname, '..', 'data', 'tier-cache.json');
        this.tierCache = {
            common: [],
            rare: [],
            legendary: [],
            rare_1of1: [],
            legendary_1of1: []
        };

        this.tierLimits = {
            common: 2500,
            rare: 1750,
            legendary: 738,
            rare_1of1: 10,
            legendary_1of1: 2
        };

        // Load cache and generate tiers
        this.loadTierCache().then(() => {
            if (this.getTotalCached() === 0) {
                console.log('🔄 No cache found, generating tiers from metadata...');
                this.generateTiers();
            } else {
                console.log(`✅ Loaded ${this.getTotalCached()} tokens from cache`);
                this.printRaritySummary();
            }
        }).catch(console.error);
    }

    /**
     * Generate tier distribution deterministically
     */
    async generateTiers() {
        console.log('🎲 Generating tier distribution from metadata files...');

        // Reset cache
        this.tierCache = {
            common: [],
            rare: [],
            legendary: [],
            rare_1of1: [],
            legendary_1of1: []
        };

        const totalTokens = 5000;

        // Process tokens in batches to avoid memory issues
        const batchSize = 100;

        for (let start = 1; start <= totalTokens; start += batchSize) {
            const end = Math.min(start + batchSize - 1, totalTokens);
            console.log(`🔍 Processing tokens ${start} to ${end}...`);

            for (let tokenId = start; tokenId <= end; tokenId++) {
                try {
                    const tier = await this.getTierByTokenId(tokenId);
                    this.tierCache[tier].push(tokenId);
                } catch (error) {
                    console.error(`Failed to get tier for token ${tokenId}:`, error.message);
                }
            }
        }

        this.printRaritySummary();
        await this.saveTierCache().catch(console.error);
    }
    /**
     * Deterministic tier distribution by token ID
     */
    async getTierByTokenId(tokenId) {
        try {
            // Read the metadata file
            const metadataPath = path.join(this.metadataDir, `${tokenId}.json`);
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            const metadata = JSON.parse(metadataContent);

            console.log(`📄 Token ${tokenId} metadata loaded`);

            // Look for Rarity attribute in metadata
            const rarityAttr = metadata.attributes?.find(attr =>
                attr.trait_type.toLowerCase() === 'rarity'
            );

            if (rarityAttr) {
                const rarity = rarityAttr.value.toLowerCase();
                console.log(`🎯 Token ${tokenId} has rarity in metadata: ${rarity}`);

                // Map to your tier system
                if (rarity.includes('legendary')) {
                    return 'legendary';
                } else if (rarity.includes('rare')) {
                    return 'rare';
                } else if (rarity.includes('common')) {
                    return 'common';
                }
            }

            // If no rarity found, check for tier attribute
            const tierAttr = metadata.attributes?.find(attr =>
                attr.trait_type.toLowerCase() === 'tier'
            );

            if (tierAttr) {
                const tier = tierAttr.value.toLowerCase();
                console.log(`🎯 Token ${tokenId} has tier in metadata: ${tier}`);

                if (tier.includes('legendary')) {
                    return 'legendary';
                } else if (tier.includes('rare')) {
                    return 'rare';
                } else if (tier.includes('common')) {
                    return 'common';
                }
            }

            // Default to common if no rarity/tier found
            console.log(`⚠️ Token ${tokenId}: No rarity/tier found, defaulting to common`);
            return 'common';

        } catch (error) {
            console.error(`❌ Error reading metadata for token ${tokenId}:`, error.message);
            // Fallback to deterministic distribution for missing files
            return this.getDeterministicTier(tokenId);
        }
    }

    getDeterministicTier(tokenId) {
        console.log(`🎲 Using deterministic tier for token ${tokenId} (metadata missing)`);

        // Keep your original logic as fallback
        if (tokenId <= 2) return 'legendary_1of1';
        if (tokenId <= 12) return 'rare_1of1';
        if (tokenId <= 750) return 'legendary';
        if (tokenId <= 2500) return 'rare';
        return 'common';
    }

    /**
     * Load tier cache from file
     */
    async loadTierCache() {
        try {
            const data = await fs.readFile(this.cacheFile, 'utf8');
            this.tierCache = JSON.parse(data);
            console.log(`✅ Loaded tier cache: ${this.getTotalCached()} tokens`);
        } catch (error) {
            console.log('ℹ️  No tier cache found, generating fresh tiers');
            this.generateTiers();
        }
    }

    /**
     * Save tier cache to file
     */
    async saveTierCache() {
        try {
            const dataDir = path.join(__dirname, '..', 'data');
            await fs.mkdir(dataDir, { recursive: true });

            await fs.writeFile(this.cacheFile, JSON.stringify(this.tierCache, null, 2));
            console.log(`💾 Saved tier cache: ${this.getTotalCached()} tokens`);
        } catch (error) {
            console.error('❌ Error saving tier cache:', error.message);
        }
    }

    /**
     * Get total number of cached tokens
     */
    getTotalCached() {
        return Object.values(this.tierCache).reduce((sum, arr) => sum + arr.length, 0);
    }

    /**
     * Get tier for a token (uses cache)
     */
    async getTierForToken(tokenId) {
        // Check cache first
        for (const [tier, tokens] of Object.entries(this.tierCache)) {
            if (tokens.includes(tokenId)) {
                return tier;
            }
        }

        // If not in cache, read from metadata
        const tier = await this.getTierByTokenId(tokenId);
        this.tierCache[tier].push(tokenId);

        // Save to cache file asynchronously
        this.saveTierCache().catch(console.error);

        return tier;
    }

    /**
     * Get all token IDs for a specific tier
     */
    getTokensByTier(tier) {
        if (!this.tierCache[tier]) {
            console.warn(`⚠️  Tier "${tier}" not found in cache`);
            return [];
        }
        return this.tierCache[tier];
    }

    /**
     * Get tier statistics
     */
    getTierStats() {
        return {
            common: {
                count: this.tierCache.common ? this.tierCache.common.length : 0,
                limit: this.tierLimits.common
            },
            rare: {
                count: this.tierCache.rare ? this.tierCache.rare.length : 0,
                limit: this.tierLimits.rare
            },
            legendary: {
                count: this.tierCache.legendary ? this.tierCache.legendary.length : 0,
                limit: this.tierLimits.legendary
            },
            rare_1of1: {
                count: this.tierCache.rare_1of1 ? this.tierCache.rare_1of1.length : 0,
                limit: this.tierLimits.rare_1of1
            },
            legendary_1of1: {
                count: this.tierCache.legendary_1of1 ? this.tierCache.legendary_1of1.length : 0,
                limit: this.tierLimits.legendary_1of1
            }
        };
    }

    /**
     * Print rarity summary
     */
    printRaritySummary() {
        const stats = this.getTierStats();
        const total = Object.values(stats).reduce((sum, stat) => sum + stat.count, 0);

        console.log('\n🎲 Rarity Distribution:');
        console.log('═══════════════════════════════════════');
        console.log(`Common:     ${stats.common.count} NFTs (${((stats.common.count / total) * 100).toFixed(1)}%)`);
        console.log(`Rare:       ${stats.rare.count} NFTs (${((stats.rare.count / total) * 100).toFixed(1)}%)`);
        console.log(`Legendary:  ${stats.legendary.count} NFTs (${((stats.legendary.count / total) * 100).toFixed(1)}%)`);
        console.log(`Rare 1-of-1: ${stats.rare_1of1.count} NFTs`);
        console.log(`Legendary 1-of-1: ${stats.legendary_1of1.count} NFTs`);
        console.log('═══════════════════════════════════════');
        console.log(`Total: ${total} NFTs\n`);
    }

    /**
     * Rebuild tiers from metadata (admin function)
     */
    async rebuildTiersFromMetadata() {
        console.log('🔄 Rebuilding tiers using deterministic distribution...');
        this.generateTiers();
        return this.getTierStats();
    }

    /**
     * Get available tokens for a tier (not minted)
     */
    getAvailableTokensByTier(tier, mintedTokens) {
        const allTokens = this.getTokensByTier(tier);
        return allTokens.filter(tokenId => !mintedTokens.has(tokenId));
    }
}

module.exports = TierService;