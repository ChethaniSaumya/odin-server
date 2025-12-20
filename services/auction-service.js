const { Client, PrivateKey, TokenMintTransaction } = require("@hashgraph/sdk");
const MintService = require('./mint-service');
const TierService = require('./tier-service');
require('dotenv').config();

/**
 * AuctionService - Manages the special 1-of-1 NFT auctions
 * 
 * Creates and manages:
 * - 10 Rare 1-of-1 NFTs (starting bid: 7,200 HBAR)
 * - 2 Legendary 1-of-1 NFTs (starting bid: 22,000 HBAR)
 */
class AuctionService {
    constructor() {
        this.mintService = new MintService();
        this.tierService = new TierService();
        
        // Track active auctions
        this.activeAuctions = {};
        
        // Special NFT configurations
        this.specialNFTs = {
            rare1of1: Array(10).fill().map((_, i) => ({
                id: `rare-1of1-${i+1}`,
                name: `Odin Rare 1-of-1 #${i+1}`,
                tier: 'rare_1of1',
                isSpecial: true,
                startingBid: 2,  // 7,200 HBAR (~$500)
                description: "Exclusive rare 1-of-1 auction edition"
            })),
            legendary1of1: Array(2).fill().map((_, i) => ({
                id: `legendary-1of1-${i+1}`,
                name: `Odin Legendary 1-of-1 #${i+1}`,
                tier: 'legendary_1of1',
                isSpecial: true,
                startingBid: 3,  // 22,000 HBAR (~$1,500)
                description: "Ultra-rare legendary 1-of-1 auction masterpiece"
            }))
        };
    }

    /**
     * Setup all auction NFTs (mints them to treasury for auction)
     * This should be run ONCE before auctions start
     */
    async setupAuctionNFTs() {
        try {
            console.log('\n🎨 Setting up Special Auction NFTs...\n');
            
            const results = [];
            
            // Get token IDs assigned to rare_1of1 and legendary_1of1
            const rare1of1Tokens = this.tierService.getTokensByTier('rare_1of1');
            const legendary1of1Tokens = this.tierService.getTokensByTier('legendary_1of1');

            // Check if tiers are assigned
            if (rare1of1Tokens.length < 10) {
                throw new Error(`Not enough rare_1of1 tokens assigned. Found ${rare1of1Tokens.length}, need 10`);
            }
            if (legendary1of1Tokens.length < 2) {
                throw new Error(`Not enough legendary_1of1 tokens assigned. Found ${legendary1of1Tokens.length}, need 2`);
            }

            console.log('📋 Rare 1-of-1 Assignments:');
            console.log(`   Token IDs: ${rare1of1Tokens.slice(0, 10).join(', ')}\n`);
            
            console.log('📋 Legendary 1-of-1 Assignments:');
            console.log(`   Token IDs: ${legendary1of1Tokens.slice(0, 2).join(', ')}\n`);

            // Mint Rare 1-of-1 NFTs to treasury
            console.log('🎨 Minting 10 Rare 1-of-1 NFTs...\n');
            for (let i = 0; i < 10; i++) {
                const nftConfig = this.specialNFTs.rare1of1[i];
                const tokenId = rare1of1Tokens[i];
                
                console.log(`   Minting ${nftConfig.name} (Token ID: ${tokenId})...`);
                
                // Mint to treasury for auction
                const result = await this.mintService.mintNFT(
                    process.env.TREASURY_ACCOUNT_ID || process.env.OPERATOR_ID,
                    { tokenId: tokenId, isAirdrop: false }
                );

                results.push({
                    ...result,
                    nftDetails: nftConfig,
                    status: 'awaiting_auction',
                    startingBid: nftConfig.startingBid
                });

                console.log(`   ✅ Minted: Serial #${result.serialNumber}\n`);
            }

            // Mint Legendary 1-of-1 NFTs to treasury
            console.log('🎨 Minting 2 Legendary 1-of-1 NFTs...\n');
            for (let i = 0; i < 2; i++) {
                const nftConfig = this.specialNFTs.legendary1of1[i];
                const tokenId = legendary1of1Tokens[i];
                
                console.log(`   Minting ${nftConfig.name} (Token ID: ${tokenId})...`);
                
                const result = await this.mintService.mintNFT(
                    process.env.TREASURY_ACCOUNT_ID || process.env.OPERATOR_ID,
                    { tokenId: tokenId, isAirdrop: false }
                );

                results.push({
                    ...result,
                    nftDetails: nftConfig,
                    status: 'awaiting_auction',
                    startingBid: nftConfig.startingBid
                });

                console.log(`   ✅ Minted: Serial #${result.serialNumber}\n`);
            }

            console.log('═══════════════════════════════════════');
            console.log('✅ All Auction NFTs Created!');
            console.log('═══════════════════════════════════════');
            console.log(`Total Special NFTs: ${results.length}`);
            console.log(`  Rare 1-of-1: 10 NFTs`);
            console.log(`  Legendary 1-of-1: 2 NFTs`);
            console.log('═══════════════════════════════════════\n');

            return {
                success: true,
                totalCreated: results.length,
                rare1of1: results.slice(0, 10),
                legendary1of1: results.slice(10, 12),
                details: results
            };

        } catch (error) {
            console.error('❌ Error setting up auction NFTs:', error);
            throw error;
        } finally {
            this.mintService.close();
        }
    }

    /**
     * Start an auction for a specific NFT
     * @param {number} nftSerial - The serial number of the NFT
     * @param {number} durationHours - How long the auction runs (default: 72 hours)
     * @param {number} startingBid - Starting bid in HBAR (optional, uses default if not provided)
     */
    async startAuction(nftSerial, durationHours = 72, startingBid = null) {
        try {
            // Check if auction already exists
            if (this.activeAuctions[nftSerial]) {
                throw new Error(`Auction already exists for NFT #${nftSerial}`);
            }

            const now = new Date();
            const endTime = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

            const auction = {
                nftSerial: nftSerial,
                startingBid: startingBid || 7200, // Default to rare starting bid
                currentBid: 0,
                currentBidder: null,
                startTime: now,
                endTime: endTime,
                durationHours: durationHours,
                bids: [],
                isActive: true,
                status: 'active'
            };

            this.activeAuctions[nftSerial] = auction;

            console.log(`🔨 Auction Started!`);
            console.log(`   NFT Serial: #${nftSerial}`);
            console.log(`   Starting Bid: ${auction.startingBid} HBAR`);
            console.log(`   Duration: ${durationHours} hours`);
            console.log(`   Ends: ${endTime.toISOString()}\n`);

            return auction;

        } catch (error) {
            console.error('❌ Error starting auction:', error);
            throw error;
        }
    }

    /**
     * Place a bid on an active auction
     * @param {number} nftSerial - NFT serial number
     * @param {string} bidderAccountId - Hedera account ID of bidder
     * @param {number} bidAmount - Bid amount in HBAR
     */
    async placeBid(nftSerial, bidderAccountId, bidAmount) {
        try {
            const auction = this.activeAuctions[nftSerial];

            // Validate auction exists and is active
            if (!auction) {
                throw new Error(`No auction found for NFT #${nftSerial}`);
            }

            if (!auction.isActive) {
                throw new Error(`Auction for NFT #${nftSerial} is not active`);
            }

            // Check if auction has ended
            if (new Date() > auction.endTime) {
                auction.isActive = false;
                auction.status = 'ended';
                throw new Error(`Auction for NFT #${nftSerial} has ended`);
            }

            // Validate bid amount
            const minimumBid = auction.currentBid > 0 
                ? auction.currentBid * 1.05  // 5% increment required
                : auction.startingBid;

            if (bidAmount < minimumBid) {
                throw new Error(
                    `Bid must be at least ${minimumBid.toFixed(2)} HBAR (current: ${auction.currentBid} HBAR)`
                );
            }

            // Record the bid
            const bid = {
                bidder: bidderAccountId,
                amount: bidAmount,
                timestamp: new Date(),
                bidNumber: auction.bids.length + 1
            };

            auction.bids.push(bid);
            auction.currentBid = bidAmount;
            auction.currentBidder = bidderAccountId;

            console.log(`🔨 New Bid Placed!`);
            console.log(`   NFT Serial: #${nftSerial}`);
            console.log(`   Bidder: ${bidderAccountId}`);
            console.log(`   Amount: ${bidAmount} HBAR`);
            console.log(`   Total Bids: ${auction.bids.length}\n`);

            // TODO: In production, verify actual HBAR payment here
            // using Hedera Mirror Node API

            return {
                success: true,
                auction: auction,
                bid: bid
            };

        } catch (error) {
            console.error('❌ Error placing bid:', error);
            throw error;
        }
    }

    /**
     * End an auction and transfer NFT to winner
     * @param {number} nftSerial - NFT serial number
     */
    async endAuction(nftSerial) {
        try {
            const auction = this.activeAuctions[nftSerial];

            if (!auction) {
                throw new Error(`No auction found for NFT #${nftSerial}`);
            }

            if (!auction.isActive) {
                throw new Error(`Auction is already ended`);
            }

            // Mark as ended
            auction.isActive = false;
            auction.status = 'ended';
            auction.endedAt = new Date();

            if (auction.currentBidder) {
                auction.winner = auction.currentBidder;
                auction.winningBid = auction.currentBid;

                console.log(`🏆 Auction Ended!`);
                console.log(`   NFT Serial: #${nftSerial}`);
                console.log(`   Winner: ${auction.winner}`);
                console.log(`   Winning Bid: ${auction.winningBid} HBAR`);
                console.log(`   Total Bids: ${auction.bids.length}\n`);

                // TODO: Transfer NFT to winner
                // This would use TransferTransaction to send from treasury to winner

                return {
                    success: true,
                    winner: auction.winner,
                    winningBid: auction.winningBid,
                    totalBids: auction.bids.length,
                    auction: auction
                };
            } else {
                console.log(`⚠️  Auction Ended with No Bids`);
                console.log(`   NFT Serial: #${nftSerial}`);
                console.log(`   Status: No winner\n`);

                return {
                    success: false,
                    reason: 'No bids received',
                    auction: auction
                };
            }

        } catch (error) {
            console.error('❌ Error ending auction:', error);
            throw error;
        }
    }

    /**
     * Get auction details
     */
    getAuction(nftSerial) {
        const auction = this.activeAuctions[nftSerial];
        
        if (!auction) {
            return null;
        }

        const now = new Date();
        const timeRemaining = auction.endTime - now;
        const hoursRemaining = Math.max(0, timeRemaining / (1000 * 60 * 60));

        return {
            ...auction,
            timeRemaining: hoursRemaining,
            isExpired: now > auction.endTime,
            bidCount: auction.bids.length
        };
    }

    /**
     * Get all active auctions
     */
    getAllAuctions() {
        return Object.values(this.activeAuctions).map(auction => {
            const now = new Date();
            const timeRemaining = auction.endTime - now;
            const hoursRemaining = Math.max(0, timeRemaining / (1000 * 60 * 60));

            return {
                nftSerial: auction.nftSerial,
                currentBid: auction.currentBid,
                currentBidder: auction.currentBidder,
                startingBid: auction.startingBid,
                bidCount: auction.bids.length,
                timeRemaining: hoursRemaining,
                isActive: auction.isActive && now <= auction.endTime,
                status: auction.status
            };
        });
    }

    /**
     * Get bid history for an auction
     */
    getBidHistory(nftSerial) {
        const auction = this.activeAuctions[nftSerial];
        
        if (!auction) {
            throw new Error(`No auction found for NFT #${nftSerial}`);
        }

        return {
            nftSerial: nftSerial,
            totalBids: auction.bids.length,
            currentBid: auction.currentBid,
            bids: auction.bids.map(bid => ({
                bidNumber: bid.bidNumber,
                bidder: bid.bidder,
                amount: bid.amount,
                timestamp: bid.timestamp
            }))
        };
    }
}

module.exports = AuctionService;