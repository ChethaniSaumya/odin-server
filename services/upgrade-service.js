const {
    TokenUpdateTransaction,
    TokenPauseTransaction,
    TokenUnpauseTransaction,
    CustomRoyaltyFee,
    CustomFixedFee,
    Hbar,
    PrivateKey,
    PublicKey
} = require("@hashgraph/sdk");
require("dotenv").config();

class UpgradeService {
    constructor(client, tokenId) {
        this.client = client;
        this.tokenId = tokenId;
        
        // Load admin keys from environment
        this.adminKey = process.env.ADMIN_KEY 
            ? PrivateKey.fromString(process.env.ADMIN_KEY)
            : null;
        
        this.supplyKey = process.env.SUPPLY_KEY
            ? PrivateKey.fromString(process.env.SUPPLY_KEY)
            : null;
            
        this.feeScheduleKey = process.env.FEE_SCHEDULE_KEY
            ? PrivateKey.fromString(process.env.FEE_SCHEDULE_KEY)
            : null;
    }

    /**
     * Update the token/collection name
     * Requires: ADMIN_KEY
     */
    async updateTokenName(newName) {
        try {
            if (!this.adminKey) {
                throw new Error("ADMIN_KEY not found in environment variables");
            }

            console.log(`🔄 Updating token name to: ${newName}`);

            const transaction = await new TokenUpdateTransaction()
                .setTokenId(this.tokenId)
                .setTokenName(newName)
                .freezeWith(this.client);

            const signedTx = await transaction.sign(this.adminKey);
            const txResponse = await signedTx.execute(this.client);
            const receipt = await txResponse.getReceipt(this.client);

            console.log(`✅ Token name updated successfully`);

            return {
                status: receipt.status.toString(),
                newName: newName,
                transactionId: txResponse.transactionId.toString()
            };
        } catch (error) {
            console.error("❌ Error updating token name:", error);
            throw error;
        }
    }

    /**
     * Update token symbol
     * Requires: ADMIN_KEY
     */
    async updateTokenSymbol(newSymbol) {
        try {
            if (!this.adminKey) {
                throw new Error("ADMIN_KEY not found in environment variables");
            }

            console.log(`🔄 Updating token symbol to: ${newSymbol}`);

            const transaction = await new TokenUpdateTransaction()
                .setTokenId(this.tokenId)
                .setTokenSymbol(newSymbol)
                .freezeWith(this.client);

            const signedTx = await transaction.sign(this.adminKey);
            const txResponse = await signedTx.execute(this.client);
            const receipt = await txResponse.getReceipt(this.client);

            console.log(`✅ Token symbol updated successfully`);

            return {
                status: receipt.status.toString(),
                newSymbol: newSymbol,
                transactionId: txResponse.transactionId.toString()
            };
        } catch (error) {
            console.error("❌ Error updating token symbol:", error);
            throw error;
        }
    }

    /**
     * Update royalty fee structure
     * Requires: FEE_SCHEDULE_KEY
     * 
     * Current structure from requirements:
     * - 3% → Digital Realms Treasury / $ODIN liquidity
     * - 2% → $HBARBARIAN buyback & liquidity
     * - 2% → Development & creative teams
     * - 1% → Artist & Blue Economy fund
     */
    async updateRoyalties(royaltyStructure) {
        try {
            if (!this.feeScheduleKey) {
                throw new Error("FEE_SCHEDULE_KEY not found in environment variables");
            }

            console.log(`🔄 Updating royalty structure...`);

            // Create custom royalty fees (8% total)
            const customFees = [];

            // Digital Realms Treasury - 3%
            if (royaltyStructure.digitalRealms) {
                customFees.push(
                    new CustomRoyaltyFee()
                        .setNumerator(royaltyStructure.digitalRealms.percentage || 3)
                        .setDenominator(100)
                        .setFeeCollectorAccountId(royaltyStructure.digitalRealms.accountId)
                        .setFallbackFee(new CustomFixedFee().setHbarAmount(new Hbar(200)))
                );
            }

            // HBARBARIAN Buyback - 2%
            if (royaltyStructure.hbarbarianBuyback) {
                customFees.push(
                    new CustomRoyaltyFee()
                        .setNumerator(royaltyStructure.hbarbarianBuyback.percentage || 2)
                        .setDenominator(100)
                        .setFeeCollectorAccountId(royaltyStructure.hbarbarianBuyback.accountId)
                        .setFallbackFee(new CustomFixedFee().setHbarAmount(new Hbar(200)))
                );
            }

            // Development Team - 2%
            if (royaltyStructure.development) {
                customFees.push(
                    new CustomRoyaltyFee()
                        .setNumerator(royaltyStructure.development.percentage || 2)
                        .setDenominator(100)
                        .setFeeCollectorAccountId(royaltyStructure.development.accountId)
                        .setFallbackFee(new CustomFixedFee().setHbarAmount(new Hbar(200)))
                );
            }

            // Artist Fund - 1%
            if (royaltyStructure.artistFund) {
                customFees.push(
                    new CustomRoyaltyFee()
                        .setNumerator(royaltyStructure.artistFund.percentage || 1)
                        .setDenominator(100)
                        .setFeeCollectorAccountId(royaltyStructure.artistFund.accountId)
                        .setFallbackFee(new CustomFixedFee().setHbarAmount(new Hbar(200)))
                );
            }

            const transaction = await new TokenUpdateTransaction()
                .setTokenId(this.tokenId)
                .setCustomFees(customFees)
                .freezeWith(this.client);

            const signedTx = await transaction.sign(this.feeScheduleKey);
            const txResponse = await signedTx.execute(this.client);
            const receipt = await txResponse.getReceipt(this.client);

            console.log(`✅ Royalties updated successfully`);

            return {
                status: receipt.status.toString(),
                royaltyStructure: royaltyStructure,
                totalPercentage: Object.values(royaltyStructure).reduce((sum, r) => sum + (r.percentage || 0), 0),
                transactionId: txResponse.transactionId.toString()
            };
        } catch (error) {
            console.error("❌ Error updating royalties:", error);
            throw error;
        }
    }

    /**
     * Pause the token (emergency stop)
     * Requires: PAUSE_KEY (usually same as ADMIN_KEY)
     * When paused: No transfers, no minting
     */
    async pauseToken() {
        try {
            if (!this.adminKey) {
                throw new Error("ADMIN_KEY (pause key) not found");
            }

            console.log(`⏸️  Pausing token...`);

            const transaction = await new TokenPauseTransaction()
                .setTokenId(this.tokenId)
                .freezeWith(this.client);

            const signedTx = await transaction.sign(this.adminKey);
            const txResponse = await signedTx.execute(this.client);
            const receipt = await txResponse.getReceipt(this.client);

            console.log(`✅ Token paused successfully`);

            return {
                status: receipt.status.toString(),
                paused: true,
                message: "All transfers and minting are now paused",
                transactionId: txResponse.transactionId.toString()
            };
        } catch (error) {
            console.error("❌ Error pausing token:", error);
            throw error;
        }
    }

    /**
     * Unpause the token
     * Requires: PAUSE_KEY (usually same as ADMIN_KEY)
     */
    async unpauseToken() {
        try {
            if (!this.adminKey) {
                throw new Error("ADMIN_KEY (pause key) not found");
            }

            console.log(`▶️  Unpausing token...`);

            const transaction = await new TokenUnpauseTransaction()
                .setTokenId(this.tokenId)
                .freezeWith(this.client);

            const signedTx = await transaction.sign(this.adminKey);
            const txResponse = await signedTx.execute(this.client);
            const receipt = await txResponse.getReceipt(this.client);

            console.log(`✅ Token unpaused successfully`);

            return {
                status: receipt.status.toString(),
                paused: false,
                message: "Token is now active",
                transactionId: txResponse.transactionId.toString()
            };
        } catch (error) {
            console.error("❌ Error unpausing token:", error);
            throw error;
        }
    }

    /**
     * Transfer admin key to DAO (progressive decentralization)
     * Requires: ADMIN_KEY
     * 
     * WARNING: This is irreversible! Make sure the new key is correct.
     */
    async transferAdminKey(newAdminPublicKey) {
        try {
            if (!this.adminKey) {
                throw new Error("ADMIN_KEY not found");
            }

            console.log(`🔐 Transferring admin key to DAO...`);
            console.log(`⚠️  WARNING: This will transfer full control!`);

            const newKey = PublicKey.fromString(newAdminPublicKey);

            const transaction = await new TokenUpdateTransaction()
                .setTokenId(this.tokenId)
                .setAdminKey(newKey)
                .freezeWith(this.client);

            const signedTx = await transaction.sign(this.adminKey);
            const txResponse = await signedTx.execute(this.client);
            const receipt = await txResponse.getReceipt(this.client);

            console.log(`✅ Admin key transferred successfully`);
            console.log(`⚠️  You no longer have admin control!`);

            return {
                status: receipt.status.toString(),
                newAdminKey: newAdminPublicKey,
                message: "Admin key transferred to DAO - original admin key no longer has control",
                transactionId: txResponse.transactionId.toString()
            };
        } catch (error) {
            console.error("❌ Error transferring admin key:", error);
            throw error;
        }
    }

    /**
     * Make token immutable (remove ALL admin capabilities)
     * Requires: ADMIN_KEY
     * 
     * CRITICAL WARNING: This is PERMANENT and IRREVERSIBLE!
     * After this, NO ONE can:
     * - Update metadata
     * - Change royalties
     * - Pause/unpause
     * - Make any changes
     * 
     * Only do this for final, community-owned collections
     */
    async makeImmutable() {
        try {
            if (!this.adminKey) {
                throw new Error("ADMIN_KEY not found");
            }

            console.log(`🔒 Making token IMMUTABLE...`);
            console.log(`⚠️  WARNING: This is PERMANENT and IRREVERSIBLE!`);

            // Remove all keys to make immutable
            const transaction = await new TokenUpdateTransaction()
                .setTokenId(this.tokenId)
                .setAdminKey(new PublicKey.fromString("0x0000000000000000000000000000000000000000")) // Null key
                .setSupplyKey(new PublicKey.fromString("0x0000000000000000000000000000000000000000"))
                .setPauseKey(new PublicKey.fromString("0x0000000000000000000000000000000000000000"))
                .setFeeScheduleKey(new PublicKey.fromString("0x0000000000000000000000000000000000000000"))
                .freezeWith(this.client);

            const signedTx = await transaction.sign(this.adminKey);
            const txResponse = await signedTx.execute(this.client);
            const receipt = await txResponse.getReceipt(this.client);

            console.log(`✅ Token is now IMMUTABLE`);
            console.log(`🔒 NO ONE can make changes anymore!`);

            return {
                status: receipt.status.toString(),
                immutable: true,
                message: "Token is now fully decentralized and immutable - no further changes possible",
                transactionId: txResponse.transactionId.toString()
            };
        } catch (error) {
            console.error("❌ Error making token immutable:", error);
            throw error;
        }
    }

    /**
     * Update token memo/description
     * Requires: ADMIN_KEY
     */
    async updateTokenMemo(newMemo) {
        try {
            if (!this.adminKey) {
                throw new Error("ADMIN_KEY not found");
            }

            console.log(`🔄 Updating token memo...`);

            const transaction = await new TokenUpdateTransaction()
                .setTokenId(this.tokenId)
                .setTokenMemo(newMemo)
                .freezeWith(this.client);

            const signedTx = await transaction.sign(this.adminKey);
            const txResponse = await signedTx.execute(this.client);
            const receipt = await txResponse.getReceipt(this.client);

            console.log(`✅ Token memo updated`);

            return {
                status: receipt.status.toString(),
                newMemo: newMemo,
                transactionId: txResponse.transactionId.toString()
            };
        } catch (error) {
            console.error("❌ Error updating token memo:", error);
            throw error;
        }
    }

    /**
     * Get current token info
     */
    async getTokenInfo() {
        try {
            const query = new TokenInfoQuery()
                .setTokenId(this.tokenId);

            const info = await query.execute(this.client);

            return {
                tokenId: info.tokenId.toString(),
                name: info.name,
                symbol: info.symbol,
                totalSupply: info.totalSupply.toString(),
                maxSupply: info.maxSupply.toString(),
                treasury: info.treasuryAccountId.toString(),
                customFees: info.customFees.map(fee => fee.toString()),
                isPaused: info.pauseStatus
            };
        } catch (error) {
            console.error("❌ Error fetching token info:", error);
            throw error;
        }
    }
}

module.exports = UpgradeService;