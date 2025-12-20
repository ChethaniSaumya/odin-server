const fs = require('fs').promises;
const path = require('path');
const { updateFileOnGitHub } = require('./githubHelper');
const githubSyncService = require('./github-sync-service');

class MintRecorder {
    constructor() {
        this.recordsFile = path.join(__dirname, '..', 'data', 'mint-records.json');
        this.githubRecordsPath = 'data/mint-records.json'; // Adjust to match your repo structure
        this.records = [];
        this.loadRecords();
    }

    /**
     * Load existing records from file
     */
    async loadRecords() {
        try {
            const data = await fs.readFile(this.recordsFile, 'utf8');
            this.records = JSON.parse(data);
            console.log(`📚 Loaded ${this.records.length} mint records from file`);
        } catch (error) {
            // File doesn't exist yet, start fresh
            console.log('🆕 No previous mint records found, starting fresh');
            this.records = [];
        }
    }

    /**
     * Record a new mint
     */
    async recordMint(mintData) {
        const record = {
            // Core NFT Data
            serialNumber: mintData.serialNumber,
            metadataTokenId: mintData.metadataTokenId,
            hederaTokenId: mintData.tokenId || process.env.TOKEN_ID,
            
            // Tier & Allocation
            rarity: mintData.rarity,
            tierName: this.getTierName(mintData.rarity),
            odinAllocation: mintData.odinAllocation || this.getOdinAllocation(mintData.rarity),
            
            // Owner & Transaction
            ownerAccountId: mintData.owner || mintData.userAccountId,
            mintTransactionId: mintData.transactionId,
            paymentTransactionHash: mintData.paymentTransactionHash || null,
            
            // Pricing (if available)
            paidAmount: mintData.paidAmount || null,
            paidCurrency: mintData.paidCurrency || 'HBAR',
            hbarUsdRate: mintData.hbarUsdRate || null,
            
            // Metadata
            metadataUri: mintData.metadataUri || mintData.metadataUrl || null,
            ipfsGatewayUrl: mintData.ipfsGatewayUrl || null,
            
            // Timestamps
            mintedAt: mintData.mintedAt || new Date().toISOString(),
            timestamp: Date.now(),
            
            // Type
            isAirdrop: mintData.isAirdrop || false,
            mintType: mintData.isAirdrop ? 'airdrop' : 'public_mint'
        };

        // Add to records array
        this.records.push(record);

        // Save to file AND GitHub
        await this.saveRecords();

        console.log(`📝 Recorded mint: Serial #${record.serialNumber}, Metadata ID: ${record.metadataTokenId}`);

        return record;
    }

    /**
     * Record batch mint (multiple NFTs)
     */
    async recordBatchMint(batchData) {
        const records = [];

        for (const mintData of batchData) {
            const record = await this.recordMint(mintData);
            records.push(record);
        }

        console.log(`📝 Recorded ${records.length} mints in batch`);
        return records;
    }

    /**
     * Save records to file AND sync to GitHub
     */
    async saveRecords() {
        try {
            // Ensure data directory exists
            const dataDir = path.join(__dirname, '..', 'data');
            await fs.mkdir(dataDir, { recursive: true });

            const content = JSON.stringify(this.records, null, 2);

            // Save locally
            await fs.writeFile(this.recordsFile, content, 'utf8');
            console.log(`💾 Saved ${this.records.length} records locally`);

            // ✅ SYNC TO GITHUB
            try {
                await updateFileOnGitHub(
                    this.githubRecordsPath,
                    content,
                    `Update mint records: ${this.records.length} total mints - ${new Date().toISOString()}`
                );
                console.log('☁️ Mint records synced to GitHub');
            } catch (githubError) {
                console.error('⚠️ GitHub sync failed:', githubError.message);
                // Continue even if GitHub sync fails
            }

        } catch (error) {
            console.error('❌ Failed to save mint records:', error.message);
            throw error;
        }
    }

    /**
     * Get tier display name
     */
    getTierName(rarity) {
        const tierNames = {
            common: 'Common Warrior',
            rare: 'Rare Champion',
            legendary: 'Legendary Hero',
            legendary_1of1: 'Legendary 1-of-1'
        };
        return tierNames[rarity] || rarity;
    }

    /**
     * Get ODIN allocation for tier
     */
    getOdinAllocation(rarity) {
        const allocations = {
            common: 40000,
            rare: 300000,
            legendary: 1000000,
            legendary_1of1: 1000000
        };
        return allocations[rarity] || 0;
    }

    /**
     * Get all records
     */
    getAllRecords() {
        return this.records;
    }

    /**
     * Get records by rarity
     */
    getRecordsByRarity(rarity) {
        return this.records.filter(r => r.rarity === rarity);
    }

    /**
     * Get records by owner
     */
    getRecordsByOwner(accountId) {
        return this.records.filter(r => r.ownerAccountId === accountId);
    }

    /**
     * Get mint statistics
     */
    getStatistics() {
        const stats = {
            totalMinted: this.records.length,
            byRarity: {
                common: 0,
                rare: 0,
                legendary: 0,
                legendary_1of1: 0
            },
            totalOdinAllocated: 0,
            lastMintTime: null
        };

        for (const record of this.records) {
            if (stats.byRarity[record.rarity] !== undefined) {
                stats.byRarity[record.rarity]++;
            }
            stats.totalOdinAllocated += record.odinAllocation;
        }

        if (this.records.length > 0) {
            stats.lastMintTime = this.records[this.records.length - 1].mintedAt;
        }

        return stats;
    }

    /**
     * Export records to CSV
     */
    async exportToCSV() {
        const csvFile = path.join(__dirname, '..', 'data', 'mint-records.csv');
        
        if (this.records.length === 0) {
            console.log('⚠️  No records to export');
            return null;
        }

        // CSV headers
        const headers = [
            'Serial Number',
            'Metadata Token ID',
            'Hedera Token ID',
            'Rarity',
            'Tier Name',
            'ODIN Allocation',
            'Owner Account ID',
            'Mint Transaction ID',
            'Minted At',
            'Mint Type'
        ].join(',');

        // CSV rows
        const rows = this.records.map(record => [
            record.serialNumber,
            record.metadataTokenId,
            record.hederaTokenId,
            record.rarity,
            record.tierName,
            record.odinAllocation,
            record.ownerAccountId,
            record.mintTransactionId,
            record.mintedAt,
            record.mintType
        ].join(','));

        const csvContent = [headers, ...rows].join('\n');

        await fs.writeFile(csvFile, csvContent, 'utf8');
        console.log(`📊 Exported ${this.records.length} records to ${csvFile}`);

        return csvFile;
    }

    /**
     * Search records
     */
    searchRecords(criteria) {
        return this.records.filter(record => {
            for (const [key, value] of Object.entries(criteria)) {
                if (record[key] !== value) {
                    return false;
                }
            }
            return true;
        });
    }
}

// Create singleton instance
const mintRecorder = new MintRecorder();

module.exports = mintRecorder;