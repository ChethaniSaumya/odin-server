const axios = require('axios'); // Changed from fetch to axios

class PriceService {
    constructor() {
        this.cachedPrice = null;
        this.lastFetchTime = null;
        this.cacheDuration = 5 * 60 * 1000; // 5 minutes cache
        
        // Fixed USD prices for each tier
       /* this.usdPrices = {
            common: 100,
            rare: 500,
            legendary: 1500
        };*/

        this.usdPrices = {
            common: 0.1,
            rare: 0.2,
            legendary: 0.3
        };
        
        console.log('💰 PriceService initialized');
        console.log('   USD Prices - Common: $100, Rare: $500, Legendary: $1500');
    }

    /**
     * Fetch HBAR price from CoinGecko
     */
    async fetchHbarPrice() {
        try {
            const now = Date.now();
            
            // Return cached price if still valid
            if (this.cachedPrice && this.lastFetchTime && (now - this.lastFetchTime) < this.cacheDuration) {
                console.log('📊 Using cached HBAR price:', this.cachedPrice);
                return this.cachedPrice;
            }

            console.log('🔄 Fetching fresh HBAR price from CoinGecko...');
            
            // FIXED: Use axios instead of fetch
            const response = await axios.get(
                'https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd',
                {
                    headers: {
                        'Accept': 'application/json'
                    },
                    timeout: 5000 // 5 second timeout
                }
            );

            const hbarPrice = response.data['hedera-hashgraph']?.usd;

            if (!hbarPrice || hbarPrice <= 0) {
                throw new Error('Invalid HBAR price received');
            }

            this.cachedPrice = hbarPrice;
            this.lastFetchTime = now;

            console.log('✅ HBAR Price fetched: $' + hbarPrice);
            return hbarPrice;

        } catch (error) {
            console.error('❌ Failed to fetch HBAR price:', error.message);
            
            // Return cached price if available, otherwise use fallback
            if (this.cachedPrice) {
                console.log('⚠️ Using stale cached price:', this.cachedPrice);
                return this.cachedPrice;
            }
            
            // Fallback price if everything fails
            const fallbackPrice = 0.07; // ~$0.07 per HBAR as fallback
            console.log('⚠️ Using fallback price:', fallbackPrice);
            return fallbackPrice;
        }
    }

    /**
     * Convert USD amount to HBAR
     */
    async usdToHbar(usdAmount) {
        const hbarPrice = await this.fetchHbarPrice();
        const hbarAmount = usdAmount / hbarPrice;
        
        // Round to 2 decimal places
        return Math.ceil(hbarAmount * 100) / 100;
    }

    /**
     * Get dynamic pricing for all tiers
     */
    async getDynamicPricing() {
        const hbarPrice = await this.fetchHbarPrice();
        
        const pricing = {
            hbarUsdPrice: hbarPrice,
            lastUpdated: new Date().toISOString(),
            tiers: {
                common: {
                    usdPrice: this.usdPrices.common,
                    hbarPrice: Math.ceil((this.usdPrices.common / hbarPrice) * 100) / 100,
                    odinAllocation: 40000
                },
                rare: {
                    usdPrice: this.usdPrices.rare,
                    hbarPrice: Math.ceil((this.usdPrices.rare / hbarPrice) * 100) / 100,
                    odinAllocation: 300000
                },
                legendary: {
                    usdPrice: this.usdPrices.legendary,
                    hbarPrice: Math.ceil((this.usdPrices.legendary / hbarPrice) * 100) / 100,
                    odinAllocation: 1000000
                }
            }
        };

        console.log('📊 Dynamic Pricing Calculated:');
        console.log(`   HBAR/USD: $${hbarPrice}`);
        console.log(`   Common: $${this.usdPrices.common} = ${pricing.tiers.common.hbarPrice} HBAR`);
        console.log(`   Rare: $${this.usdPrices.rare} = ${pricing.tiers.rare.hbarPrice} HBAR`);
        console.log(`   Legendary: $${this.usdPrices.legendary} = ${pricing.tiers.legendary.hbarPrice} HBAR`);

        return pricing;
    }

    /**
     * Verify if paid amount is within acceptable range
     * Allows 5% tolerance for price fluctuations
     */
    async verifyPaymentAmount(rarity, paidHbarAmount, quantity = 1) {
        const pricing = await this.getDynamicPricing();
        const expectedHbarPerNFT = pricing.tiers[rarity]?.hbarPrice;
        
        if (!expectedHbarPerNFT) {
            throw new Error(`Invalid rarity: ${rarity}`);
        }

        const expectedTotal = expectedHbarPerNFT * quantity;
        const tolerance = 0.05; // 5% tolerance
        const minAcceptable = expectedTotal * (1 - tolerance);
        const maxAcceptable = expectedTotal * (1 + tolerance);

        const isValid = paidHbarAmount >= minAcceptable && paidHbarAmount <= maxAcceptable;

        return {
            isValid,
            expectedHbarPerNFT,
            expectedTotal,
            paidAmount: paidHbarAmount,
            minAcceptable,
            maxAcceptable,
            currentHbarPrice: pricing.hbarUsdPrice
        };
    }

    /**
     * Get current HBAR price (cached)
     */
    async getCurrentHbarPrice() {
        return await this.fetchHbarPrice();
    }

    /**
     * Force refresh price (bypass cache)
     */
    async forceRefreshPrice() {
        this.cachedPrice = null;
        this.lastFetchTime = null;
        return await this.fetchHbarPrice();
    }
}

// Create singleton instance
const priceService = new PriceService();

module.exports = priceService;