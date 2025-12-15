const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
require("dotenv").config();
const { updateFileOnGitHub } = require('./githubHelper');

class TierServiceCategorized {
    constructor() {
        this.categorizationFile = path.join(__dirname, 'rarity-categorization.json');
        this.mintedTrackerFile = path.join(__dirname, 'data', 'minted-tracker.json');
        this.githubTrackerPath = 'services/data/minted-tracker.json';
        
        // Lock mechanism for thread safety
        this.mintLock = false;
        this.lockAcquiredAt = null;
        
        // Data structures
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
        
        // ✅ Load data synchronously
        this.loadAllDataSync();
        console.log('✅ TierServiceCategorized initialized');
    }

    /**
     * Thread-safe method to get next token ID
     */
    async getNextTokenIdSafe(tier, quantity = 1) {
        const maxWaitTime = 30000;
        const startTime = Date.now();
        
        // Wait for lock with timeout
        while (this.mintLock) {
            const elapsed = Date.now() - startTime;
            if (elapsed > maxWaitTime) {
                throw new Error(`Mint timeout: System busy. Please try again.`);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        try {
            // Acquire lock
            this.mintLock = true;
            this.lockAcquiredAt = new Date().toISOString();
            
            console.log(`🔒 Lock acquired for ${tier} x${quantity}`);
            
            // Get next token IDs
            const result = await this.getNextTokenId(tier, quantity);
            
            return result;
            
        } finally {
            // Always release lock
            this.mintLock = false;
            this.lockAcquiredAt = null;
            console.log(`🔓 Lock released`);
        }
    }

    /**
     * Load all data synchronously
     */
    loadAllDataSync() {
        try {
            // Load categorization
            const catData = fsSync.readFileSync(this.categorizationFile, 'utf8');
            const categorization = JSON.parse(catData);
            
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
            console.error('❌ Error loading categorization:', error.message);
            throw error;
        }
        
        // Load minted tracker
        this.loadMintedTrackerSync();
    }

    /**
     * Load minted tracker synchronously
     */
    loadMintedTrackerSync() {
        try {
            const data = fsSync.readFileSync(this.mintedTrackerFile, 'utf8');
            const tracker = JSON.parse(data);
            
            // Validate and merge with current structure
            this.mintedTracker = {
                common: Array.isArray(tracker.common) ? tracker.common : [],
                rare: Array.isArray(tracker.rare) ? tracker.rare : [],
                legendary: Array.isArray(tracker.legendary) ? tracker.legendary : [],
                legendary_1of1: Array.isArray(tracker.legendary_1of1) ? tracker.legendary_1of1 : [],
                nextIndex: {
                    common: tracker.nextIndex?.common || 0,
                    rare: tracker.nextIndex?.rare || 0,
                    legendary: tracker.nextIndex?.legendary || 0,
                    legendary_1of1: tracker.nextIndex?.legendary_1of1 || 0
                }
            };
            
            console.log('📊 Minted tracker loaded:');
            console.log(`   Common minted: ${this.mintedTracker.common.length}`);
            console.log(`   Rare minted: ${this.mintedTracker.rare.length}`);
            console.log(`   Legendary minted: ${this.mintedTracker.legendary.length}`);
            
        } catch (error) {
            console.log('🆕 No minted tracker found, creating new one');
            this.createNewTracker();
        }
    }

    /**
     * Create new minted tracker
     */
    createNewTracker() {
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

    /**
     * Save minted tracker synchronously with retry
     */
    saveMintedTrackerSync() {
        const maxRetries = 3;
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const dataDir = path.dirname(this.mintedTrackerFile);
                
                // Ensure directory exists
                if (!fsSync.existsSync(dataDir)) {
                    fsSync.mkdirSync(dataDir, { recursive: true });
                }
                
                // Create backup before saving
                if (fsSync.existsSync(this.mintedTrackerFile)) {
                    const backupFile = `${this.mintedTrackerFile}.backup`;
                    fsSync.copyFileSync(this.mintedTrackerFile, backupFile);
                }
                
                // Save to file
                const content = JSON.stringify(this.mintedTracker, null, 2);
                fsSync.writeFileSync(this.mintedTrackerFile, content);
                
                console.log(`💾 Minted tracker saved locally (attempt ${attempt}/${maxRetries})`);
                console.log(`   Common: ${this.mintedTracker.common.length} IDs`);
                console.log(`   Rare: ${this.mintedTracker.rare.length} IDs`);
                console.log(`   Legendary: ${this.mintedTracker.legendary.length} IDs`);
                console.log(`   NextIndex: ${JSON.stringify(this.mintedTracker.nextIndex)}`);
                
                // Sync to GitHub (async, don't block)
                this.syncToGitHubAsync(content);
                
                return true;
                
            } catch (error) {
                lastError = error;
                console.error(`⚠️ Save attempt ${attempt} failed:`, error.message);
                
                if (attempt < maxRetries) {
                    // Wait before retry
                    setTimeout(() => {}, 100);
                }
            }
        }
        
        console.error('❌ All save attempts failed:', lastError.message);
        throw lastError;
    }

    /**
     * Async GitHub sync (fire and forget)
     */
    async syncToGitHubAsync(content) {
        try {
            await updateFileOnGitHub(
                this.githubTrackerPath,
                content,
                `Update minted tracker: ${new Date().toISOString()} - ${Object.values(this.mintedTracker.nextIndex).reduce((a, b) => a + b, 0)} total minted`
            );
            console.log('☁️ Minted tracker synced to GitHub');
        } catch (error) {
            console.error('⚠️ GitHub sync failed:', error.message);
            // Don't throw - GitHub sync failure shouldn't break minting
        }
    }

    /**
     * Get next token ID for minting
     */
    async getNextTokenId(tier, quantity = 1) {
        const tierKey = tier.toLowerCase();
        
        if (!this.rarityMapping[tierKey]) {
            throw new Error(`Invalid tier: ${tier}`);
        }
        
        // Reload tracker to ensure we have latest data
        this.loadMintedTrackerSync();
        
        const startIndex = this.mintedTracker.nextIndex[tierKey] || 0;
        const availableTokens = this.rarityMapping[tierKey];
        
        console.log(`🔍 getNextTokenId: tier=${tierKey}, startIndex=${startIndex}, totalTokens=${availableTokens.length}`);
        
        // Check availability
        if (startIndex + quantity > availableTokens.length) {
            throw new Error(`Not enough ${tier} tokens available. Requested: ${quantity}, Available: ${availableTokens.length - startIndex}`);
        }
        
        // Get next token IDs
        const metadataTokenIds = [];
        for (let i = 0; i < quantity; i++) {
            const tokenId = availableTokens[startIndex + i];
            metadataTokenIds.push(tokenId);
        }
        
        console.log(`🎯 Next ${quantity} ${tier} token(s):`, metadataTokenIds);
        
        // Update nextIndex immediately
        this.mintedTracker.nextIndex[tierKey] = startIndex + quantity;
        
        // Save immediately to prevent double-minting
        this.saveMintedTrackerSync();
        
        return {
            metadataTokenIds: metadataTokenIds,
            startIndex: startIndex
        };
    }

    /**
     * CRITICAL FIX: Mark tokens as minted (robust version)
     */
    async markAsMinted(tier, tokenIds) {
        const tierKey = tier.toLowerCase();
        
        if (!Array.isArray(tokenIds)) {
            tokenIds = [tokenIds];
        }
        
        console.log(`📝 Marking as minted: ${tierKey} - IDs: ${tokenIds.join(', ')}`);
        
        // Reload tracker to get current state
        this.loadMintedTrackerSync();
        
        // Add token IDs to minted list (avoid duplicates)
        let addedCount = 0;
        for (const tokenId of tokenIds) {
            if (!this.mintedTracker[tierKey].includes(tokenId)) {
                this.mintedTracker[tierKey].push(tokenId);
                addedCount++;
            } else {
                console.warn(`⚠️ Token ${tokenId} already in minted list for ${tierKey}`);
            }
        }
        
        // Sort minted list (numerically)
        this.mintedTracker[tierKey].sort((a, b) => a - b);
        
        // Update nextIndex to match actual minted count
        this.mintedTracker.nextIndex[tierKey] = this.mintedTracker[tierKey].length;
        
        console.log(`📊 Updated ${tierKey}:`);
        console.log(`   Minted IDs: ${this.mintedTracker[tierKey].slice(-5).join(', ')} (${this.mintedTracker[tierKey].length} total)`);
        console.log(`   NextIndex: ${this.mintedTracker.nextIndex[tierKey]}`);
        console.log(`   Added: ${addedCount} new IDs`);
        
        // Save with retry logic
        this.saveMintedTrackerSync();
        
        // Verify save was successful
        this.verifyTrackerConsistency(tierKey);
        
        console.log(`✅ Successfully marked ${tokenIds.length} ${tier} token(s) as minted`);
    }

    /**
     * Verify tracker consistency
     */
    verifyTrackerConsistency(tierKey) {
        try {
            // Reload from disk to verify
            const data = fsSync.readFileSync(this.mintedTrackerFile, 'utf8');
            const diskTracker = JSON.parse(data);
            
            const inMemoryCount = this.mintedTracker[tierKey].length;
            const diskCount = diskTracker[tierKey]?.length || 0;
            
            if (inMemoryCount !== diskCount) {
                console.error(`❌ Tracker inconsistency detected for ${tierKey}:`);
                console.error(`   In-memory: ${inMemoryCount} IDs`);
                console.error(`   On disk: ${diskCount} IDs`);
                
                // Try to auto-fix by using the larger count
                if (inMemoryCount > diskCount) {
                    console.log('🔄 Auto-fixing: Using in-memory data');
                    fsSync.writeFileSync(this.mintedTrackerFile, JSON.stringify(this.mintedTracker, null, 2));
                } else {
                    console.log('🔄 Auto-fixing: Using disk data');
                    this.mintedTracker[tierKey] = diskTracker[tierKey] || [];
                    this.mintedTracker.nextIndex[tierKey] = diskTracker.nextIndex?.[tierKey] || 0;
                }
            }
            
        } catch (error) {
            console.error('⚠️ Tracker verification failed:', error.message);
        }
    }

    /**
     * Get available count for a tier
     */
    getAvailableCount(tier) {
        const tierKey = tier.toLowerCase();
        if (!this.rarityMapping[tierKey]) return 0;
        
        const totalTokens = this.rarityMapping[tierKey].length;
        const mintedCount = this.mintedTracker[tierKey]?.length || 0;
        
        return Math.max(0, totalTokens - mintedCount);
    }

    /**
     * Get tier statistics
     */
    getTierStats() {
        const stats = {};
        
        for (const tier in this.rarityMapping) {
            const total = this.rarityMapping[tier].length;
            const minted = this.mintedTracker[tier]?.length || 0;
            const available = Math.max(0, total - minted);
            
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
        
        this.saveMintedTrackerSync();
        console.log('🔄 Minting tracker reset');
    }

    /**
     * Print current status
     */
    printStatus() {
        const stats = this.getTierStats();
        
        console.log('\n📊 MINTING TRACKER STATUS:');
        console.log('═══════════════════════════════════════');
        
        for (const [tier, data] of Object.entries(stats)) {
            if (tier !== 'nextIndex') {
                console.log(`${tier.toUpperCase()}:`);
                console.log(`   Total: ${data.total}`);
                console.log(`   Minted: ${data.minted}`);
                console.log(`   Available: ${data.available}`);
                console.log(`   Next Index: ${this.mintedTracker.nextIndex[tier]}`);
                console.log(`   Last 3 minted: ${this.mintedTracker[tier].slice(-3).join(', ') || 'None'}`);
                console.log('');
            }
        }
        
        console.log('═══════════════════════════════════════\n');
    }
}

module.exports = TierServiceCategorized;
