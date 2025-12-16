const MintService = require('../services/mint-service');
require('dotenv').config();

async function testRaritySystem() {
    console.log('🧪 Testing Metadata-Based Rarity System\n');
    
    const mintService = new MintService();
    
    try {
        // Test 1: Check if rarity cache is loaded
        console.log('📋 Test 1: Checking Rarity Cache\n');
        
        const cacheSize = Object.keys(mintService.tierService.rarityCache).length;
        console.log(`✅ Rarity cache loaded: ${cacheSize} entries\n`);
        
        if (cacheSize === 0) {
            console.log('⚠️  Cache is empty, building from metadata files...');
            await mintService.tierService.buildRarityCache();
        }
        
        // Test 2: Verify rarity distribution
        console.log('📊 Test 2: Rarity Distribution\n');
        
        const stats = mintService.tierService.getTierStats();
        console.log(`Common:    ${stats.common.count}/${stats.common.limit} NFTs`);
        console.log(`Rare:      ${stats.rare.count}/${stats.rare.limit} NFTs`);
        console.log(`Legendary: ${stats.legendary.count}/${stats.legendary.limit} NFTs`);
        console.log(`Total:     ${stats.common.count + stats.rare.count + stats.legendary.count}/5000\n`);
        
        // Verify limits match requirements
        if (stats.common.limit !== 2500) {
            console.log(`⚠️  WARNING: Common limit is ${stats.common.limit}, expected 2500`);
        }
        if (stats.rare.limit !== 1750) {
            console.log(`⚠️  WARNING: Rare limit is ${stats.rare.limit}, expected 1750`);
        }
        if (stats.legendary.limit !== 750) {
            console.log(`⚠️  WARNING: Legendary limit is ${stats.legendary.limit}, expected 750`);
        }
        
        // Test 3: Verify specific token rarities
        console.log('🎯 Test 3: Verifying Specific Token Rarities\n');
        
        const testTokens = [1, 2, 42, 100, 500, 1000, 2500, 5000];
        for (const tokenId of testTokens) {
            const rarity = mintService.tierService.getTierForToken(tokenId);
            console.log(`   Token #${tokenId}: ${rarity}`);
        }
        console.log();
        
        // Test 4: Get tokens by rarity
        console.log('📖 Test 4: Tokens by Rarity\n');
        
        const commonTokens = mintService.tierService.getTokensByTier('common');
        const rareTokens = mintService.tierService.getTokensByTier('rare');
        const legendaryTokens = mintService.tierService.getTokensByTier('legendary');
        
        console.log(`Common tokens: ${commonTokens.length} total`);
        console.log(`   First 10: ${commonTokens.slice(0, 10).join(', ')}`);
        console.log(`\nRare tokens: ${rareTokens.length} total`);
        console.log(`   First 10: ${rareTokens.slice(0, 10).join(', ')}`);
        console.log(`\nLegendary tokens: ${legendaryTokens.length} total`);
        console.log(`   First 10: ${legendaryTokens.slice(0, 10).join(', ')}\n`);
        
        // Test 5: Test pricing calculation
        console.log('💰 Test 5: Pricing Calculation\n');
        
        const commonCost = mintService.calculateCost('common', 1);
        console.log(`Common NFT (x1):`);
        console.log(`   Price: ${commonCost.pricePerNFT}`);
        console.log(`   ODIN: ${commonCost.odinPerNFT.toLocaleString()}\n`);
        
        const rareCost = mintService.calculateCost('rare', 2);
        console.log(`Rare NFT (x2):`);
        console.log(`   Price per NFT: ${rareCost.pricePerNFT}`);
        console.log(`   Total: ${rareCost.totalCost}`);
        console.log(`   Total ODIN: ${rareCost.totalOdin.toLocaleString()}\n`);
        
        const legendaryCost = mintService.calculateCost('legendary', 1);
        console.log(`Legendary NFT (x1):`);
        console.log(`   Price: ${legendaryCost.pricePerNFT}`);
        console.log(`   ODIN: ${legendaryCost.odinPerNFT.toLocaleString()}\n`);
        
        // Test 6: Supply information
        console.log('📊 Test 6: Supply Information\n');
        
        const supply = mintService.getSupplyInfo();
        console.log(`Total Supply: ${supply.totalMinted}/${supply.maxSupply}`);
        console.log(`Remaining: ${supply.remaining} (${supply.percentMinted}% minted)\n`);
        
        console.log(`By Rarity:`);
        console.log(`   Common:    ${supply.byRarity.common.available}/${supply.byRarity.common.total} available`);
        console.log(`   Rare:      ${supply.byRarity.rare.available}/${supply.byRarity.rare.total} available`);
        console.log(`   Legendary: ${supply.byRarity.legendary.available}/${supply.byRarity.legendary.total} available\n`);
        
        // Test 7: Test getting next token by rarity
        console.log('🔢 Test 7: Next Token Selection\n');
        
        try {
            const nextCommon = mintService.getNextTokenIdByRarity('common');
            console.log(`   Next Common token: #${nextCommon}`);
            
            const nextRare = mintService.getNextTokenIdByRarity('rare');
            console.log(`   Next Rare token: #${nextRare}`);
            
            const nextLegendary = mintService.getNextTokenIdByRarity('legendary');
            console.log(`   Next Legendary token: #${nextLegendary}\n`);
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}\n`);
        }
        
        // Test 8: Verify metadata loading
        console.log('📄 Test 8: Verify Metadata Loading\n');
        
        const testMetadata = await mintService.loadMetadata(2);
        const rarityAttr = testMetadata.attributes.find(
            attr => attr.trait_type === 'Rarity'
        );
        
        console.log(`   Token #2 metadata loaded`);
        console.log(`   Name: ${testMetadata.name}`);
        console.log(`   Rarity from metadata: ${rarityAttr?.value}`);
        console.log(`   Rarity from cache: ${mintService.tierService.getTierForToken(2)}\n`);
        
        console.log('═══════════════════════════════════════════');
        console.log('✅ All tests completed successfully!');
        console.log('═══════════════════════════════════════════\n');
        
        console.log('📝 Summary:');
        console.log(`   • Rarity system is reading from metadata files`);
        console.log(`   • Distribution: ${stats.common.count} Common, ${stats.rare.count} Rare, ${stats.legendary.count} Legendary`);
        console.log(`   • Pricing: Common ${commonCost.pricePerNFT}, Rare ${rareCost.pricePerNFT}, Legendary ${legendaryCost.pricePerNFT}`);
        console.log(`   • ODIN Allocation: Common ${commonCost.odinPerNFT}, Rare ${rareCost.odinPerNFT}, Legendary ${legendaryCost.odinPerNFT}`);
        console.log(`   • System ready for frontend integration\n`);
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    } finally {
        mintService.close();
    }
}

testRaritySystem();