const admin = require('firebase-admin');
const db = admin.firestore();

class TierServiceFirebase {
    constructor() {
        this.categorizationFile = require('./rarity-categorization.json');
        
        this.rarityMapping = {
            common: this.categorizationFile.Common || [],
            rare: this.categorizationFile.Rare || [],
            legendary: this.categorizationFile.Legendary || [],
            legendary_1of1: this.categorizationFile["Legendary 1-of-1"] || []
        };

        console.log('🔥 TierServiceFirebase initialized');
        console.log(`   Common: ${this.rarityMapping.common.length} tokens`);
        console.log(`   Rare: ${this.rarityMapping.rare.length} tokens`);
        console.log(`   Legendary: ${this.rarityMapping.legendary.length} tokens`);
    }

    /**
     * ✅ ATOMIC: Reserve tokens using Firestore transaction
     */
    async reserveAndCommit(tier, quantity) {
        const tierKey = tier.toLowerCase();
        console.log(`🔥 Firebase atomic reserve: ${quantity} ${tier} tokens`);

        const tierRef = db.collection('mint_tracker').doc(tierKey);
        
        try {
            // ✅ Firestore Transaction - FULLY ATOMIC
            const result = await db.runTransaction(async (transaction) => {
                const tierDoc = await transaction.get(tierRef);
                
                // Initialize if doesn't exist
                if (!tierDoc.exists) {
                    const initData = {
                        tier: tierKey,
                        minted: [],
                        nextIndex: 0,
                        totalTokens: this.rarityMapping[tierKey].length,
                        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                    };
                    transaction.set(tierRef, initData);
                    
                    // Return first tokens
                    const tokenIds = this.rarityMapping[tierKey].slice(0, quantity);
                    transaction.update(tierRef, {
                        minted: admin.firestore.FieldValue.arrayUnion(...tokenIds),
                        nextIndex: quantity,
                        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                    });
                    
                    return tokenIds;
                }
                
                const data = tierDoc.data();
                const currentIndex = data.nextIndex || 0;
                const minted = data.minted || [];
                const available = this.rarityMapping[tierKey];
                
                // Check availability
                if (currentIndex + quantity > available.length) {
                    throw new Error(`Not enough ${tier} tokens available. Requested: ${quantity}, Available: ${available.length - currentIndex}`);
                }
                
                // Get next token IDs
                const tokenIds = [];
                for (let i = 0; i < quantity; i++) {
                    tokenIds.push(available[currentIndex + i]);
                }
                
                console.log(`🎯 Reserving tokens: ${tokenIds.join(', ')}`);
                
                // Update in transaction (atomic!)
                transaction.update(tierRef, {
                    minted: admin.firestore.FieldValue.arrayUnion(...tokenIds),
                    nextIndex: currentIndex + quantity,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                });
                
                return tokenIds;
            });
            
            console.log(`✅ Firebase reserved successfully: ${result.join(', ')}`);
            return result;
            
        } catch (error) {
            console.error(`❌ Firebase reservation failed:`, error.message);
            throw error;
        }
    }

    /**
     * ✅ Record successful mint
     */
    async finalizeMint(tier, tokenIds, mintResult) {
        const tierKey = tier.toLowerCase();
        
        // Store mint records in separate collection
        const batch = db.batch();
        
        for (let i = 0; i < tokenIds.length; i++) {
            const mintRef = db.collection('mints').doc();
            batch.set(mintRef, {
                tokenId: tokenIds[i],
                tier: tierKey,
                serialNumber: mintResult.serialNumbers ? mintResult.serialNumbers[i] : mintResult.serialNumber,
                transactionId: mintResult.transactionId,
                mintedAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'completed'
            });
        }
        
        await batch.commit();
        console.log(`✅ Firebase finalized ${tokenIds.length} mints`);
    }

    /**
     * ✅ Rollback if mint fails
     */
    async rollbackMint(tier, tokenIds) {
        const tierKey = tier.toLowerCase();
        const tierRef = db.collection('mint_tracker').doc(tierKey);
        
        await db.runTransaction(async (transaction) => {
            const tierDoc = await transaction.get(tierRef);
            const data = tierDoc.data();
            
            // Remove from minted array
            const updatedMinted = data.minted.filter(id => !tokenIds.includes(id));
            
            // Recalculate nextIndex
            const newNextIndex = updatedMinted.length;
            
            transaction.update(tierRef, {
                minted: updatedMinted,
                nextIndex: newNextIndex,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        
        console.log(`↩️ Firebase rolled back ${tokenIds.length} tokens`);
    }

    /**
     * Get available count
     */
    async getAvailableCount(tier) {
        const tierKey = tier.toLowerCase();
        const tierRef = db.collection('mint_tracker').doc(tierKey);
        const tierDoc = await tierRef.get();
        
        if (!tierDoc.exists) {
            return this.rarityMapping[tierKey].length;
        }
        
        const data = tierDoc.data();
        const totalTokens = this.rarityMapping[tierKey].length;
        const minted = data.minted?.length || 0;
        
        return Math.max(0, totalTokens - minted);
    }

    /**
     * Get tier statistics
     */
    async getTierStats() {
        const stats = {};
        
        for (const tier of ['common', 'rare', 'legendary', 'legendary_1of1']) {
            const tierRef = db.collection('mint_tracker').doc(tier);
            const tierDoc = await tierRef.get();
            
            const total = this.rarityMapping[tier].length;
            const minted = tierDoc.exists ? (tierDoc.data().minted?.length || 0) : 0;
            const available = total - minted;
            
            stats[tier] = {
                total,
                minted,
                available,
                percentMinted: total > 0 ? ((minted / total) * 100).toFixed(2) : '0.00'
            };
        }
        
        return stats;
    }

    /**
     * Print current status
     */
    async printStatus() {
        const stats = await this.getTierStats();
        
        console.log('\n🔥 FIREBASE MINT TRACKER STATUS:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        for (const [tier, data] of Object.entries(stats)) {
            console.log(`${tier.toUpperCase()}:`);
            console.log(`   Total: ${data.total}`);
            console.log(`   Minted: ${data.minted}`);
            console.log(`   Available: ${data.available}`);
            console.log('');
        }
        
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }
}

module.exports = TierServiceFirebase;