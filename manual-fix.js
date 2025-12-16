// manual-fix.js
const fs = require('fs').promises;
const path = require('path');

async function fixTrackerManually() {
    try {
        console.log('🔧 MANUAL TRACKER FIX');
        console.log('=====================');
        
        // Load current tracker
        const trackerFile = path.join(__dirname, 'services/data/minted-tracker.json');
        const currentTracker = JSON.parse(await fs.readFile(trackerFile, 'utf8'));
        
        console.log('Current tracker:');
        console.log(`  Common: ${currentTracker.common.length} (next: ${currentTracker.nextIndex.common})`);
        console.log(`  Rare: ${currentTracker.rare.length} (next: ${currentTracker.nextIndex.rare})`);
        console.log(`  Legendary: ${currentTracker.legendary.length} (next: ${currentTracker.nextIndex.legendary})`);
        
        // ADD THE MISSING TOKEN IDs HERE
        // You need to know which token IDs were minted but not tracked
        // Example: if NFTs with token IDs 1, 2, 3, 4, 5, 6 were minted but not tracked
        // and they belong to rarities: 1,2=common, 3,4=rare, 5,6=legendary
        
        // Add missing token IDs to the tracker
        const missingTokens = {
            common: [1,2,4],     // Replace with actual missing common token IDs
            rare: [5,9,12],       // Replace with actual missing rare token IDs
            legendary: [3,24,48]   // Replace with actual missing legendary token IDs
        };
        
        console.log('\nAdding missing tokens:');
        
        // Add to tracker arrays (avoid duplicates)
        for (const rarity in missingTokens) {
            for (const tokenId of missingTokens[rarity]) {
                if (!currentTracker[rarity].includes(tokenId)) {
                    currentTracker[rarity].push(tokenId);
                    console.log(`  Added ${rarity} token #${tokenId}`);
                }
            }
        }
        
        // Update nextIndex to match minted count
        currentTracker.nextIndex.common = currentTracker.common.length;
        currentTracker.nextIndex.rare = currentTracker.rare.length;
        currentTracker.nextIndex.legendary = currentTracker.legendary.length;
        
        console.log('\nUpdated tracker:');
        console.log(`  Common: ${currentTracker.common.length} (next: ${currentTracker.nextIndex.common})`);
        console.log(`  Rare: ${currentTracker.rare.length} (next: ${currentTracker.nextIndex.rare})`);
        console.log(`  Legendary: ${currentTracker.legendary.length} (next: ${currentTracker.nextIndex.legendary})`);
        
        // Save updated tracker
        await fs.writeFile(trackerFile, JSON.stringify(currentTracker, null, 2));
        console.log('\n✅ Tracker updated successfully!');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

fixTrackerManually();