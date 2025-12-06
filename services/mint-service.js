const {
    Client,
    PrivateKey,
    TokenMintTransaction,
    TransferTransaction,
    Hbar
} = require("@hashgraph/sdk");
const fs = require('fs').promises;
const path = require('path');
const TierServiceCategorized = require('./tier-service-categorized');
const PaymentService = require('./payment-service');
require("dotenv").config();

class MintService {
    constructor() {
        this.client = Client.forTestnet();

        // FIX: Use the OPERATOR_KEY directly
        this.privateKey = PrivateKey.fromStringECDSA(process.env.OPERATOR_KEY);
        this.client.setOperator(process.env.OPERATOR_ID, this.privateKey);

        this.tokenId = process.env.TOKEN_ID;
        this.treasuryId = process.env.OPERATOR_ID;
        //this.metadataDir = path.join(__dirname, '..', 'metadata');

        // Services
        this.tierService = new TierServiceCategorized();
        this.paymentService = new PaymentService();

        // Tracking
        this.mintedTokens = new Set();
        this.totalMinted = 0;
        this.maxSupply = 5000;

        // ODIN allocations
        this.odinAllocation = {
            common: 40000,
            rare: 300000,
            legendary: 1000000
        };

        // Pricing in HBAR
        this.pricing = {
            common: new Hbar(14),
            rare: new Hbar(72),
            legendary: new Hbar(220)
        };

        this.loadMintingHistory();
        console.log('✅ MintService initialized');
    }

    /**
     * INITIATE MINT - Step 1: Get payment instructions
     */
    async initiateMint(userAccountId, rarity) {
        try {
            // Validate rarity
            if (!['common', 'rare', 'legendary'].includes(rarity)) {
                throw new Error('Invalid rarity. Must be: common, rare, legendary');
            }

            // Check supply
            if (this.totalMinted >= this.maxSupply) {
                throw new Error('All NFTs have been minted');
            }

            // DEBUG: Check tier availability
            console.log(`🔍 Checking ${rarity} availability...`);
            const available = this.getAvailableByRarity(rarity);
            console.log(`📊 ${rarity} available: ${available}`);

            // DEBUG: Check total minted and tier stats
            console.log(`📊 Total minted: ${this.totalMinted}`);
            console.log(`📊 Tier stats:`, this.tierService.getTierStats());

            if (available === 0) {
                throw new Error(`No ${rarity} NFTs available`);
            }

            const expectedAmount = this.pricing[rarity];

            // Initiate payment
            const paymentInstructions = this.paymentService.initiatePayment(
                userAccountId,
                rarity,
                expectedAmount
            );

            return {
                ...paymentInstructions,
                message: `Send exactly ${expectedAmount.toString()} HBAR to ${paymentInstructions.treasuryAccountId}`,
                instructions: [
                    `1. Open your wallet`,
                    `2. Send EXACTLY ${expectedAmount.toString()} HBAR to ${paymentInstructions.treasuryAccountId}`,
                    `3. Keep this payment ID: ${paymentInstructions.paymentId}`,
                    `4. Return here to complete minting`
                ]
            };

        } catch (error) {
            console.error('Initiate mint error:', error);
            throw error;
        }
    }

    /**
     * COMPLETE MINT - Step 2: Verify payment and mint
     */
    async completeMint(paymentId) {
        let mintResult = null;
        let payment = null;

        try {
            console.log(`🔄 Completing mint for payment: ${paymentId}`);

            // 1. Verify payment
            const paymentVerified = await this.paymentService.verifyPayment(paymentId);
            if (!paymentVerified) {
                throw new Error('Payment not verified. Please ensure you sent the exact HBAR amount.');
            }

            // 2. Get payment details
            payment = this.paymentService.getConfirmedPayment(paymentId);
            if (!payment) {
                throw new Error('Payment confirmation not found');
            }

            // 3. Check if payment was already used
            if (!this.paymentService.consumePayment(paymentId)) {
                throw new Error('Payment already used for minting');
            }

            // 4. Mint the NFT
            console.log(`🎨 Minting ${payment.rarity} NFT for ${payment.userAccountId}...`);
            mintResult = await this.mintByRarity(payment.userAccountId, payment.rarity);

            return {
                success: true,
                message: `Successfully minted ${payment.rarity} NFT!`,
                paymentId: paymentId,
                transactionId: payment.transactionId,
                ...mintResult
            };

        } catch (error) {
            console.error('Complete mint error:', error);

            // Return payment to pending if verification failed but payment exists
            const paymentStatus = this.paymentService.getPaymentStatus(paymentId);
            if (paymentStatus.status === 'confirmed') {
                this.paymentService.confirmedPayments.set(paymentId, paymentStatus.payment);
            }

            // Provide a safe error response
            return {
                success: false,
                error: error.message,
                note: "Your payment was verified but minting failed. Please contact support with your transaction hash.",
                transactionHash: payment?.transactionId || paymentId,
                mintResult: mintResult || undefined  // Safe reference
            };
        }
    }
    /**
     * CHECK PAYMENT STATUS - Step 1.5: Frontend can poll this
     */
    async checkPaymentStatus(paymentId) {
        return this.paymentService.getPaymentStatus(paymentId);
    }


    async mintByRarity(userAccountId, rarity, quantity = 1) {
        console.log(`\n🎨 MINTING ${rarity} NFT FOR ${userAccountId}`);

        try {
            // Get metadata token IDs
            const tokenData = await this.tierService.getNextTokenId(rarity, quantity);
            if (!tokenData.metadataTokenIds) {
                throw new Error('Tier service did not return metadataTokenIds');
            }

            const metadataTokenIds = tokenData.metadataTokenIds;
            console.log(`✅ Metadata token IDs:`, metadataTokenIds);

            // Use SUPPLY_KEY for minting
            const supplyKey = PrivateKey.fromString(process.env.SUPPLY_KEY);

            // Prepare metadata bytes - STORE IPFS URL, not just token ID
            const allMetadataBytes = [];
            const METADATA_CID = "bafybeibx4xw6e6r2x5trv4lskhtjqs2y2qfgmajbf6c3k6oohcsmv2cuwu";

            for (let i = 0; i < metadataTokenIds.length; i++) {
                const tokenId = metadataTokenIds[i];

                // Create the IPFS URL
                const ipfsUrl = `ipfs://${METADATA_CID}/${tokenId}.json`;

                // Convert to bytes (UTF-8 encoded string)
                const bytes = Uint8Array.from(Buffer.from(ipfsUrl, 'utf8'));
                allMetadataBytes.push(bytes);

                console.log(`📄 Metadata for token #${tokenId}: ${ipfsUrl}`);
            }

            // Mint with supply key
            const mintTx = new TokenMintTransaction()
                .setTokenId(this.tokenId)
                .setMetadata(allMetadataBytes)
                .freezeWith(this.client);

            // Sign and execute
            const signedTx = await mintTx.sign(supplyKey);
            const txResponse = await signedTx.execute(this.client);

            console.log('⏳ Waiting for receipt...');
            const receipt = await txResponse.getReceipt(this.client);

            if (receipt.status.toString() !== 'SUCCESS') {
                throw new Error(`Minting failed with status: ${receipt.status.toString()}`);
            }

            // Get serial number from receipt
            if (!receipt.serials || receipt.serials.length === 0) {
                throw new Error('No serial number returned from mint transaction');
            }

            const serialNumber = receipt.serials[0].toNumber();
            console.log(`✅ Transaction successful! Serial: ${serialNumber || 'N/A'}`);

            // Transfer NFT to user
            console.log(`📤 Transferring NFT #${serialNumber} to ${userAccountId}...`);

            const transferTx = await new TransferTransaction()
                .addNftTransfer(this.tokenId, serialNumber, this.treasuryId, userAccountId)
                .freezeWith(this.client);

            const operatorKey = PrivateKey.fromStringECDSA(process.env.OPERATOR_KEY);
            const signedTransferTx = await transferTx.sign(operatorKey);
            const transferResponse = await signedTransferTx.execute(this.client);
            const transferReceipt = await transferResponse.getReceipt(this.client);

            if (transferReceipt.status.toString() !== 'SUCCESS') {
                throw new Error(`Transfer failed with status: ${transferReceipt.status.toString()}`);
            }

            console.log(`✅ NFT transferred to ${userAccountId}`);

            // Mark as minted
            await this.tierService.markAsMinted(rarity, metadataTokenIds);

            // Return result WITH IPFS URL
            const ipfsUrl = `ipfs://${METADATA_CID}/${metadataTokenIds[0]}.json`;

            const result = {
                success: true,
                tokenId: this.tokenId.toString(),
                metadataTokenId: metadataTokenIds[0],
                serialNumber: serialNumber,
                rarity: rarity,
                transactionId: txResponse.transactionId.toString(),
                metadataUrl: ipfsUrl,  // Include the IPFS URL
                ipfsGatewayUrl: `https://ipfs.io/ipfs/${METADATA_CID}/${metadataTokenIds[0]}.json`  // For easy access
            };

            console.log(`✅ MINTED: Metadata URL: ${ipfsUrl}`);
            return result;

        } catch (error) {
            console.error(`❌ MINTING ERROR:`, error.message);
            console.error('Full error:', error);
            throw new Error(`Minting failed: ${error.message}`);
        }
    }

    /**
     * Load minting history from file
     */
    async loadMintingHistory() {
        try {
            const dataDir = path.join(__dirname, '..', 'data');
            await fs.mkdir(dataDir, { recursive: true });

            const trackingFile = path.join(dataDir, 'minted-tracking.json');
            const data = await fs.readFile(trackingFile, 'utf8');
            const tracking = JSON.parse(data);

            this.mintedTokens = new Set(tracking.mintedTokens || []);
            this.totalMinted = tracking.totalMinted || 0;

            console.log(`✅ Loaded minting history: ${this.totalMinted} NFTs minted`);
        } catch (error) {
            console.log(`ℹ️  No previous minting history found, starting fresh`);
        }
    }

    /**
     * Save minting history to file
     */
    async saveMintingHistory() {
        try {
            const dataDir = path.join(__dirname, '..', 'data');
            await fs.mkdir(dataDir, { recursive: true });

            const trackingFile = path.join(dataDir, 'minted-tracking.json');
            const tracking = {
                totalMinted: this.totalMinted,
                mintedTokens: Array.from(this.mintedTokens),
                lastUpdated: new Date().toISOString()
            };

            await fs.writeFile(trackingFile, JSON.stringify(tracking, null, 2));
            console.log(`💾 Saved minting history: ${this.totalMinted} NFTs`);
        } catch (error) {
            console.error(`❌ Error saving minting history:`, error.message);
        }
    }

    /**
     * Get next available token ID to mint
     */
    getNextTokenId() {
        for (let i = 1; i <= this.maxSupply; i++) {
            if (!this.mintedTokens.has(i)) {
                return i;
            }
        }
        throw new Error('All tokens have been minted');
    }

    /**
     * Load metadata for a specific token ID
     */
    async loadMetadata(tokenId) {
        try {
            // Since metadata is on IPFS, we can either:
            // 1. Fetch from IPFS (recommended for production)
            // 2. Load from local files (for testing)

            const METADATA_CID = "bafybeibx4xw6e6r2x5trv4lskhtjqs2y2qfgmajbf6c3k6oohcsmv2cuwu";
            const metadataUrl = `https://ipfs.io/ipfs/${METADATA_CID}/${tokenId}.json`;

            console.log(`📄 Fetching metadata from IPFS: ${metadataUrl}`);

            const response = await fetch(metadataUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch metadata from IPFS: ${response.status}`);
            }

            const metadata = await response.json();
            return metadata;

        } catch (error) {
            console.error(`Failed to load metadata for token ${tokenId}:`, error.message);

        }
    }

    /**
     * Enhance metadata with tier information
     */
    enhanceMetadata(originalMetadata, tier, userAccountId, isAirdrop = false) {
        // Get ODIN allocation based on tier
        const tierBase = tier.replace('_1of1', '');
        const odinAmount = this.odinAllocation[tierBase];

        // Add tier-specific attributes
        const tierAttributes = [
            {
                trait_type: "Tier",
                value: tier.charAt(0).toUpperCase() + tier.slice(1).replace('_1of1', ' 1-of-1')
            },
            {
                trait_type: "ODIN Allocation",
                value: odinAmount.toString()
            },
            {
                trait_type: "Generation",
                value: "Genesis"
            },
            {
                trait_type: "Mint Type",
                value: isAirdrop ? "Airdrop" : "Public Mint"
            },
            {
                trait_type: "Minted To",
                value: userAccountId
            },
            {
                trait_type: "Mint Date",
                value: new Date().toISOString()
            }
        ];

        // Combine with original attributes
        const enhancedMetadata = {
            ...originalMetadata,
            attributes: [
                ...(originalMetadata.attributes || []),
                ...tierAttributes
            ],
            properties: {
                tier: tier,
                odinAllocation: odinAmount,
                mintedTo: userAccountId,
                mintDate: new Date().toISOString(),
                isAirdrop: isAirdrop,
                edition: originalMetadata.edition,
                dna: originalMetadata.dna
            }
        };

        return enhancedMetadata;
    }
    /**
     * Mint multiple NFTs of specific rarity
     */
    async mintBatch(userAccountId, quantity, rarity) {
        try {
            console.log(`🔄 Batch minting ${quantity} ${rarity} NFTs for ${userAccountId}...`);

            // Reserve multiple tokens at once
            const tokenIds = await this.tierService.reserveTokens(rarity, quantity);
            console.log(`✅ Reserved ${quantity} ${rarity} tokens:`, tokenIds);

            const results = [];
            const errors = [];

            for (let i = 0; i < quantity; i++) {
                try {
                    console.log(`\n[${i + 1}/${quantity}] Minting token #${tokenIds[i]}...`);

                    const result = await this.mintNFT(userAccountId, {
                        tokenId: tokenIds[i],
                        rarity: rarity
                    });

                    results.push(result);
                    console.log(`[${i + 1}/${quantity}] ✅ Minted Serial #${result.serialNumber}`);

                } catch (error) {
                    console.error(`[${i + 1}/${quantity}] ❌ Failed:`, error.message);
                    errors.push({
                        tokenId: tokenIds[i],
                        error: error.message
                    });

                    // Continue with next token even if one fails
                }
            }

            const successful = results.length;
            const failed = errors.length;

            console.log(`\n🎯 Batch mint complete:`);
            console.log(`   Successful: ${successful}`);
            console.log(`   Failed: ${failed}`);

            if (failed > 0) {
                console.log(`   Failed tokens:`, errors.map(e => e.tokenId).join(', '));
            }

            return {
                total: quantity,
                successful: successful,
                failed: failed,
                results: results,
                errors: errors,
                allTokenIds: tokenIds
            };

        } catch (error) {
            console.error("❌ Batch minting error:", error);
            throw error;
        }
    }

    /**
     * Original mintNFT method (for backward compatibility)
     */
    /**
     * Original mintNFT method (for backward compatibility)
     */

    async mintNFT(userAccountId, options = {}) {
        try {
            console.log(`🎯 Starting NFT mint for ${userAccountId}`);
            console.log(`📦 Options:`, options);

            // Check supply limit
            if (this.totalMinted >= this.maxSupply) {
                throw new Error("Maximum supply of 5,000 NFTs reached");
            }

            // Determine which token to mint
            let tokenId;
            let tier;

            if (options.tokenId) {
                // Specific token requested
                tokenId = options.tokenId;

                // Check if already minted
                if (this.mintedTokens.has(tokenId)) {
                    throw new Error(`Token ${tokenId} has already been minted`);
                }

                // Get tier for this specific token
                tier = await this.tierService.getTierForToken(tokenId);
                console.log(`🔍 Specific token #${tokenId} requested, tier: ${tier}`);

            } else {
                // Get tier from options or default to common
                tier = options.rarity || 'common';

                // Reserve next available token for this tier
                console.log(`🔍 Reserving next ${tier} token...`);
                const tokenIds = await this.tierService.reserveTokens(tier, 1);
                tokenId = tokenIds[0];
                console.log(`✅ Reserved ${tier} token #${tokenId}`);
            }

            // Load metadata from IPFS
            console.log(`📄 Fetching metadata for token #${tokenId}...`);
            let originalMetadata;
            let metadataUri;

            if (options.metadataUri) {
                // Use provided metadata URI
                metadataUri = options.metadataUri;
                console.log(`📄 Using provided metadata URI: ${metadataUri}`);

                // Try to fetch metadata to validate
                try {
                    const response = await fetch(metadataUri.replace('ipfs://', 'https://ipfs.io/ipfs/'));
                    originalMetadata = await response.json();
                } catch (error) {
                    console.warn(`⚠️ Could not fetch metadata from URI, using fallback`);
                    originalMetadata = {
                        name: `Odin #${tokenId}`,
                        description: `Odin #${tokenId}`,
                        image: `https://bafybeigivsxoo6htxkfet4itznymlsgfjxcbhiakxutugeg2c2ypmknouq.ipfs.w3s.link/${tokenId}.png`
                    };
                }
            } else {
                // Default IPFS metadata
                const METADATA_CID = "bafybeibx4xw6e6r2x5trv4lskhtjqs2y2qfgmajbf6c3k6oohcsmv2cuwu";
                metadataUri = `ipfs://${METADATA_CID}/${tokenId}.json`;

                console.log(`📄 Fetching from IPFS: ${metadataUri}`);
                try {
                    const metadataUrl = `https://ipfs.io/ipfs/${METADATA_CID}/${tokenId}.json`;
                    const response = await fetch(metadataUrl);

                    if (!response.ok) {
                        throw new Error(`IPFS fetch failed: ${response.status}`);
                    }

                    originalMetadata = await response.json();
                    console.log(`✅ Metadata loaded from IPFS`);
                } catch (ipfsError) {
                    console.error(`❌ IPFS fetch failed:`, ipfsError.message);

                    
                }
            }

            // Enhance metadata with tier info
            console.log(`✨ Enhancing metadata for ${tier} tier...`);
            const enhancedMetadata = this.enhanceMetadata(
                originalMetadata,
                tier,
                userAccountId,
                options.isAirdrop || false
            );

            // Create metadata buffer (store URI, not full metadata)
            const metadataBuffer = Buffer.from(metadataUri);
            console.log(`📄 Storing metadata URI (${metadataBuffer.length} bytes): ${metadataUri}`);

            // Mint to treasury
            console.log(`🎨 Minting Token #${tokenId} (${tier})...`);

            const mintTx = await new TokenMintTransaction()
                .setTokenId(this.tokenId)
                .addMetadata(metadataBuffer)
                .freezeWith(this.client);

            console.log('🔑 Signing mint transaction...');

            let signedTx;

            try {
                // SUPPLY_KEY is DER format (302e...)
                const supplyKey = PrivateKey.fromString(process.env.SUPPLY_KEY);
                console.log('   ✅ SUPPLY_KEY parsed (DER format)');

                // OPERATOR_KEY is ECDSA format (0x...)
                const operatorKey = PrivateKey.fromStringECDSA(process.env.OPERATOR_KEY);
                console.log('   ✅ OPERATOR_KEY parsed (ECDSA format)');

                // Sign with both keys
                console.log('   Signing with SUPPLY_KEY...');
                signedTx = await mintTx.sign(supplyKey);

                console.log('   Also signing with OPERATOR_KEY...');
                signedTx = await signedTx.sign(operatorKey);

                console.log('   ✅ Double-signed');

            } catch (signError) {
                console.error('❌ Signing failed:', signError.message);
                throw new Error(`Failed to sign: ${signError.message}`);
            }

            // Execute mint transaction
            console.log('⚡ Executing mint transaction...');
            const mintTxSubmit = await signedTx.execute(this.client);
            const mintReceipt = await mintTxSubmit.getReceipt(this.client);

            const serialNumber = mintReceipt.serials[0].toNumber();
            console.log(`✅ NFT Minted! Serial: ${serialNumber}, Token ID: ${tokenId}`);

            // Transfer to user
            console.log(`📤 Transferring to ${userAccountId}...`);

            const transferTx = await new TransferTransaction()
                .addNftTransfer(this.tokenId, serialNumber, this.treasuryId, userAccountId)
                .freezeWith(this.client);

            // Sign transfer with OPERATOR_KEY
            const operatorKey = PrivateKey.fromStringECDSA(process.env.OPERATOR_KEY);
            const transferTxSign = await transferTx.sign(operatorKey);

            console.log('⚡ Executing transfer transaction...');
            const transferTxSubmit = await transferTxSign.execute(this.client);
            await transferTxSubmit.getReceipt(this.client);

            console.log(`✅ Transfer complete!`);

            // Update tracking
            this.mintedTokens.add(tokenId);
            this.totalMinted++;

            // Mark token as successfully minted in tier service
            if (!options.tokenId) {
                // Only mark if we reserved this token (not a specific pre-chosen one)
                await this.tierService.markAsMinted(tier, tokenId);
            }

            // Save minting history
            await this.saveMintingHistory();

            console.log(`🎉 Mint completed successfully!`);
            console.log(`   Token: #${tokenId}`);
            console.log(`   Serial: #${serialNumber}`);
            console.log(`   Tier: ${tier}`);
            console.log(`   Owner: ${userAccountId}`);
            console.log(`   Metadata: ${metadataUri}`);

            return {
                success: true,
                serialNumber: serialNumber,
                tokenId: this.tokenId.toString(),
                metadataTokenId: tokenId,
                owner: userAccountId,
                tier: tier,
                odinAllocation: this.odinAllocation[tier.replace('_1of1', '')],
                metadata: enhancedMetadata,
                transactionId: transferTxSubmit.transactionId.toString(),
                metadataUri: metadataUri,
                details: {
                    hederaTokenId: this.tokenId.toString(),
                    serialNumber: serialNumber,
                    userAccountId: userAccountId,
                    tier: tier,
                    internalTokenId: tokenId,
                    mintTransaction: mintTxSubmit.transactionId.toString(),
                    transferTransaction: transferTxSubmit.transactionId.toString(),
                    isAirdrop: options.isAirdrop || false,
                    timestamp: new Date().toISOString()
                }
            };

        } catch (error) {
            console.error("❌ NFT minting error:", error);

            // IMPORTANT: If minting failed, we need to handle the reserved token
            if (!options.tokenId && tokenId) {
                // For reserved tokens (not specific ones), we should ideally 
                // rollback the reservation. For now, we'll just log it.
                console.warn(`⚠️ Token #${tokenId} was reserved but minting failed. 
                It may need to be manually marked as available.`);
            }

            throw error;
        }
    }

    /**
     * Get supply information
     */
    getSupplyInfo() {
        const tierStats = this.tierService.getTierStats();

        return {
            totalMinted: this.totalMinted,
            maxSupply: this.maxSupply,
            remaining: this.maxSupply - this.totalMinted,
            percentMinted: ((this.totalMinted / this.maxSupply) * 100).toFixed(2),
            byRarity: {
                common: {
                    available: this.getAvailableByRarity('common'),
                    total: tierStats.common.limit,
                    minted: tierStats.common.limit - this.getAvailableByRarity('common')
                },
                rare: {
                    available: this.getAvailableByRarity('rare'),
                    total: tierStats.rare.limit,
                    minted: tierStats.rare.limit - this.getAvailableByRarity('rare')
                },
                legendary: {
                    available: this.getAvailableByRarity('legendary'),
                    total: tierStats.legendary.limit,
                    minted: tierStats.legendary.limit - this.getAvailableByRarity('legendary')
                }
            },
            byTier: {
                common: tierStats.common.count,
                rare: tierStats.rare.count,
                legendary: tierStats.legendary.count,
                rare_1of1: tierStats.rare_1of1.count,
                legendary_1of1: tierStats.legendary_1of1.count
            }
        };
    }

    /**
     * Get available (unminted) count for a rarity
     */
    getAvailableByRarity(rarity) {
        try {
            // Use TierServiceCategorized's method
            const available = this.tierService.getAvailableCount(rarity);
            console.log(`📊 ${rarity} available: ${available}`);
            return available;
        } catch (error) {
            console.error(`Error getting available ${rarity}:`, error);
            return 0;
        }
    }

    /**
     * Calculate cost for minting
     */
    calculateCost(rarity, quantity) {
        const tierBase = rarity.replace('_1of1', '');
        const pricePerNFT = this.pricing[tierBase];
        const totalCost = new Hbar(pricePerNFT.toBigNumber().multipliedBy(quantity));

        return {
            rarity: rarity,
            quantity: quantity,
            pricePerNFT: pricePerNFT.toString(),
            totalCost: totalCost.toString(),
            totalHbar: totalCost.toBigNumber().toNumber(),
            odinPerNFT: this.odinAllocation[tierBase],
            totalOdin: this.odinAllocation[tierBase] * quantity
        };
    }

    /**
     * Get available counts for all rarities
     */
    getRarityAvailability() {
        return {
            common: this.getAvailableByRarity('common'),
            rare: this.getAvailableByRarity('rare'),
            legendary: this.getAvailableByRarity('legendary')
        };
    }

    getMintStats() {
        try {
            const tierStats = this.tierService.getTierStats();

            // Calculate totalMinted from actual tier stats
            const actualTotalMinted = tierStats.common.minted +
                tierStats.rare.minted +
                tierStats.legendary.minted +
                (tierStats.legendary_1of1?.minted || 0);

            return {
                totalMinted: actualTotalMinted,
                maxSupply: this.maxSupply,
                remaining: this.maxSupply - actualTotalMinted,
                percentMinted: ((actualTotalMinted / this.maxSupply) * 100).toFixed(2),
                byRarity: {
                    common: {
                        available: tierStats.common.available,  // ✅ Use stats directly
                        total: tierStats.common.total,
                        minted: tierStats.common.minted,
                        price: this.pricing.common.toString(),
                        odinAllocation: this.odinAllocation.common
                    },
                    rare: {
                        available: tierStats.rare.available,
                        total: tierStats.rare.total,
                        minted: tierStats.rare.minted,
                        price: this.pricing.rare.toString(),
                        odinAllocation: this.odinAllocation.rare
                    },
                    legendary: {
                        available: tierStats.legendary.available,
                        total: tierStats.legendary.total,
                        minted: tierStats.legendary.minted,
                        price: this.pricing.legendary.toString(),
                        odinAllocation: this.odinAllocation.legendary
                    }
                }
            };
        } catch (error) {
            console.error('Error getting mint stats:', error);
            // Fallback
            return {
                totalMinted: this.totalMinted,
                maxSupply: this.maxSupply,
                remaining: this.maxSupply - this.totalMinted,
                percentMinted: ((this.totalMinted / this.maxSupply) * 100).toFixed(2),
                byRarity: {
                    common: { available: 2488, total: 2488, minted: 0, price: this.pricing.common.toString(), odinAllocation: this.odinAllocation.common },
                    rare: { available: 1750, total: 1750, minted: 0, price: this.pricing.rare.toString(), odinAllocation: this.odinAllocation.rare },
                    legendary: { available: 750, total: 750, minted: 0, price: this.pricing.legendary.toString(), odinAllocation: this.odinAllocation.legendary }
                }
            };
        }
    }
    /**
     * Airdrop NFTs to specific accounts
     */
    async airdropNFTs(airdropList) {
        const results = [];

        console.log(`🎁 Starting airdrop for ${airdropList.length} accounts...`);

        for (const [index, airdrop] of airdropList.entries()) {
            try {
                const { accountId, rarity } = airdrop;

                console.log(`📦 Airdropping ${rarity} to ${accountId} (${index + 1}/${airdropList.length})`);

                const result = await this.mintNFT(accountId, {
                    isAirdrop: true
                });

                results.push({
                    success: true,
                    accountId,
                    rarity,
                    ...result
                });

                console.log(`✅ Airdropped to ${accountId}`);

            } catch (error) {
                console.error(`❌ Airdrop failed for ${airdrop.accountId}:`, error.message);
                results.push({
                    success: false,
                    accountId: airdrop.accountId,
                    rarity: airdrop.rarity,
                    error: error.message
                });
            }
        }

        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        console.log(`🎯 Airdrop completed: ${successful} successful, ${failed} failed`);

        return {
            total: airdropList.length,
            successful,
            failed,
            results
        };
    }

    /**
     * Get user's minted NFTs
     */
    getUserMintedNFTs(userAccountId) {
        // This would typically query the blockchain for NFTs owned by the user
        // For now, we'll return a mock response
        console.log(`🔍 Getting minted NFTs for ${userAccountId}`);

        return {
            userAccountId,
            totalOwned: 0, // Would query blockchain
            nfts: [] // Would query blockchain
        };
    }

    /**
     * Validate if user can mint
     */
    async canUserMint(userAccountId, rarity, quantity = 1) {
        try {
            // Check supply
            if (this.totalMinted >= this.maxSupply) {
                return { canMint: false, reason: 'All NFTs have been minted' };
            }

            // Check tier availability
            const available = this.getAvailableByRarity(rarity);
            if (available < quantity) {
                return { canMint: false, reason: `Only ${available} ${rarity} NFTs available` };
            }

            // Check if user has pending payments
            const hasPending = Array.from(this.paymentService.pendingPayments.entries())
                .some(([_, payment]) => payment.userAccountId === userAccountId);

            if (hasPending) {
                return { canMint: false, reason: 'You have a pending payment. Please complete or cancel it first.' };
            }

            return {
                canMint: true,
                cost: this.calculateCost(rarity, quantity),
                available: available
            };

        } catch (error) {
            console.error('CanUserMint error:', error);
            return { canMint: false, reason: error.message };
        }
    }

    /**
     * Close client connection
     */
    close() {
        //this.client.close();
        //console.log('🔒 MintService client closed');
    }

    /**
     * Emergency reset (for testing only)
     */
    async resetForTesting() {
        if (process.env.NODE_ENV !== 'development') {
            throw new Error('Reset only allowed in development mode');
        }

        this.mintedTokens.clear();
        this.totalMinted = 0;
        this.paymentService.pendingPayments.clear();
        this.paymentService.confirmedPayments.clear();

        await this.saveMintingHistory();
        console.log('🔄 MintService reset for testing');
    }
}

module.exports = MintService;