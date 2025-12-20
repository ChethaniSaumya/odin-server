const MintService = require('./mint-service');

/**
 * AirdropService - Handles distribution of 541 NFTs to HBARbarian holders
 * 
 * Distribution rules based on HBARbarian token holdings:
 * - 1M+ tokens: 1 Common NFT
 * - 10M+ tokens: 1 Common + 1 Rare NFT
 * - 50M+ tokens: 1 Common + 1 Rare + 1 Legendary NFT
 */
class AirdropService {
    constructor() {
        this.mintService = new MintService();
        
        // Total airdrop allocation: 541 NFTs
        this.airdropAllocation = {
            total: 541,
            common: 400,    // Estimated based on holder tiers
            rare: 120,      // Estimated based on holder tiers
            legendary: 21   // Estimated based on holder tiers
        };
        
        // Track distributed NFTs
        this.distributed = {
            common: 0,
            rare: 0,
            legendary: 0
        };
    }

    /**
     * Distribute airdrop to all eligible holders
     * @param {Array} snapshotData - Array of holder objects with accountId and tokenBalance
     * 
     * Example snapshotData format:
     * [
     *   { accountId: "0.0.12345", hbarbarianTokens: 15000000 },
     *   { accountId: "0.0.67890", hbarbarianTokens: 55000000 },
     *   ...
     * ]
     */
    async distributeAirdrop(snapshotData) {
        try {
            console.log(`\n🎁 Starting Airdrop Distribution for ${snapshotData.length} holders\n`);
            
            const results = [];
            const errors = [];

            for (const holder of snapshotData) {
                try {
                    // Determine which tiers this holder qualifies for
                    const eligibleTiers = this.calculateEligibleTiers(holder.hbarbarianTokens);
                    
                    console.log(`📦 Processing holder ${holder.accountId}:`);
                    console.log(`   Tokens held: ${holder.hbarbarianTokens.toLocaleString()}`);
                    console.log(`   Eligible for: ${eligibleTiers.join(', ')}\n`);

                    // Mint NFTs for each tier the holder qualifies for
                    for (const tier of eligibleTiers) {
                        // Check if we still have allocation for this tier
                        if (this.distributed[tier] >= this.airdropAllocation[tier]) {
                            console.log(`   ⚠️  ${tier} allocation exhausted, skipping`);
                            continue;
                        }

                        // Prepare metadata for airdrop
                        const metadata = {
                            isAirdrop: true,
                            airdropReason: `HBARbarian holder - ${holder.hbarbarianTokens.toLocaleString()} tokens`,
                            snapshotDate: new Date().toISOString()
                        };

                        // Mint the NFT
                        const result = await this.mintService.mintNFT(
                            holder.accountId,
                            { isAirdrop: true }
                        );

                        results.push({
                            holder: holder.accountId,
                            tier: tier,
                            success: true,
                            serialNumber: result.serialNumber,
                            tokenId: result.metadataTokenId
                        });

                        this.distributed[tier]++;
                        
                        console.log(`   ✅ Minted ${tier} NFT #${result.serialNumber}`);
                    }

                } catch (error) {
                    console.error(`   ❌ Error processing ${holder.accountId}:`, error.message);
                    errors.push({
                        holder: holder.accountId,
                        error: error.message
                    });
                }
            }

            // Final summary
            const totalDistributed = Object.values(this.distributed).reduce((a, b) => a + b, 0);

            console.log('\n═══════════════════════════════════════');
            console.log('🎁 Airdrop Distribution Complete!');
            console.log('═══════════════════════════════════════');
            console.log(`Total NFTs Distributed: ${totalDistributed}`);
            console.log(`  Common: ${this.distributed.common}/${this.airdropAllocation.common}`);
            console.log(`  Rare: ${this.distributed.rare}/${this.airdropAllocation.rare}`);
            console.log(`  Legendary: ${this.distributed.legendary}/${this.airdropAllocation.legendary}`);
            console.log(`Successful: ${results.length}`);
            console.log(`Failed: ${errors.length}`);
            console.log('═══════════════════════════════════════\n');

            return {
                success: true,
                totalDistributed: totalDistributed,
                breakdown: this.distributed,
                successfulMints: results.length,
                failedMints: errors.length,
                details: results,
                errors: errors
            };

        } catch (error) {
            console.error('❌ Airdrop distribution failed:', error);
            throw error;
        } finally {
            this.mintService.close();
        }
    }

    /**
     * Calculate which tier(s) a holder is eligible for based on token holdings
     * @param {number} hbarbarianTokens - Number of HBARbarian tokens held
     * @returns {Array} - Array of tier names the holder qualifies for
     */
    calculateEligibleTiers(hbarbarianTokens) {
        const tiers = [];
        
        // Everyone with 1M+ tokens gets a Common NFT
        if (hbarbarianTokens >= 1000000) {
            tiers.push('common');
        }
        
        // 10M+ tokens get Common + Rare
        if (hbarbarianTokens >= 10000000) {
            tiers.push('rare');
        }
        
        // 50M+ tokens get Common + Rare + Legendary
        if (hbarbarianTokens >= 50000000) {
            tiers.push('legendary');
        }
        
        return tiers;
    }

    /**
     * Get ODIN allocation for a tier
     */
    getOdinAllocation(tier) {
        const allocations = {
            common: 40000,
            rare: 300000,
            legendary: 1000000
        };
        return allocations[tier];
    }

    /**
     * Preview airdrop distribution (dry run - doesn't actually mint)
     * Useful for checking allocation before actual distribution
     */
    async previewAirdrop(snapshotData) {
        const preview = {
            totalHolders: snapshotData.length,
            distribution: {
                common: 0,
                rare: 0,
                legendary: 0
            },
            holdersByTier: {
                common: [],
                rare: [],
                legendary: []
            }
        };

        for (const holder of snapshotData) {
            const tiers = this.calculateEligibleTiers(holder.hbarbarianTokens);
            
            for (const tier of tiers) {
                preview.distribution[tier]++;
                preview.holdersByTier[tier].push(holder.accountId);
            }
        }

        const totalNFTs = Object.values(preview.distribution).reduce((a, b) => a + b, 0);

        console.log('\n📊 Airdrop Preview:');
        console.log('═══════════════════════════════════════');
        console.log(`Total Holders: ${preview.totalHolders}`);
        console.log(`Total NFTs to Distribute: ${totalNFTs}`);
        console.log(`  Common: ${preview.distribution.common}`);
        console.log(`  Rare: ${preview.distribution.rare}`);
        console.log(`  Legendary: ${preview.distribution.legendary}`);
        console.log('═══════════════════════════════════════\n');

        return preview;
    }

    /**
     * Distribute to a single holder (for testing or manual distribution)
     */
    async distributeSingleHolder(accountId, hbarbarianTokens) {
        const tiers = this.calculateEligibleTiers(hbarbarianTokens);
        const results = [];

        console.log(`\n🎁 Distributing airdrop to ${accountId}`);
        console.log(`   Eligible tiers: ${tiers.join(', ')}\n`);

        for (const tier of tiers) {
            try {
                const result = await this.mintService.mintNFT(
                    accountId,
                    { isAirdrop: true }
                );

                results.push({
                    tier: tier,
                    success: true,
                    serialNumber: result.serialNumber
                });

                console.log(`   ✅ Minted ${tier} NFT #${result.serialNumber}`);

            } catch (error) {
                console.error(`   ❌ Failed to mint ${tier}:`, error.message);
                results.push({
                    tier: tier,
                    success: false,
                    error: error.message
                });
            }
        }

        this.mintService.close();

        return {
            accountId: accountId,
            results: results,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
        };
    }

    /**
     * Get airdrop allocation summary
     */
    getAllocationSummary() {
        return {
            total: this.airdropAllocation.total,
            allocated: this.airdropAllocation,
            distributed: this.distributed,
            remaining: {
                common: this.airdropAllocation.common - this.distributed.common,
                rare: this.airdropAllocation.rare - this.distributed.rare,
                legendary: this.airdropAllocation.legendary - this.distributed.legendary
            }
        };
    }
}

module.exports = AirdropService;