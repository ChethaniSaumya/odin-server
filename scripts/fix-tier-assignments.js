const fs = require('fs').promises;
const path = require('path');

async function correctTierDistribution() {
    console.log('🔧 Setting Up CORRECT Tier Distribution\n');
    console.log('Target Distribution:');
    console.log('  Common: 2,500');
    console.log('  Rare: 1,750');
    console.log('  Legendary: 750');
    console.log('  Rare 1-of-1: 10');
    console.log('  Legendary 1-of-1: 2');
    console.log('  Total: 5,012\n');

    // Load existing assignments to keep the special 1-of-1s
    const assignmentsFile = path.join(__dirname, '..', 'data', 'tier-assignments.json');
    let assignments;
    
    try {
        const data = await fs.readFile(assignmentsFile, 'utf8');
        assignments = JSON.parse(data);
    } catch (error) {
        assignments = {
            rare_1of1: [],
            legendary_1of1: []
        };
    }

    // Keep the special 1-of-1 tokens (these should remain)
    const rare1of1 = assignments.rare_1of1 || [7, 77, 632, 1580, 2572, 2821, 3206, 3712, 4552, 4919];
    const legendary1of1 = assignments.legendary_1of1 || [3096, 3916];

    console.log('✅ Preserving Special Auction NFTs:');
    console.log(`   Rare 1-of-1: ${rare1of1.join(', ')}`);
    console.log(`   Legendary 1-of-1: ${legendary1of1.join(', ')}\n`);

    // Get all reserved tokens (the 1-of-1s)
    const reservedTokens = new Set([...rare1of1, ...legendary1of1]);

    // Get all available tokens (1-5000, excluding reserved)
    const availableTokens = [];
    for (let i = 1; i <= 5000; i++) {
        if (!reservedTokens.has(i)) {
            availableTokens.push(i);
        }
    }

    console.log(`📝 Available tokens to assign: ${availableTokens.length}\n`);

    // Shuffle available tokens for random distribution
    const shuffled = availableTokens.sort(() => Math.random() - 0.5);

    // Assign tokens
    const legendary = shuffled.slice(0, 750).sort((a, b) => a - b);
    const rare = shuffled.slice(750, 750 + 1750).sort((a, b) => a - b);
    const common = shuffled.slice(750 + 1750).sort((a, b) => a - b);

    // Verify counts
    console.log('📊 Assignment Verification:');
    console.log(`   Legendary: ${legendary.length} (should be 750) ${legendary.length === 750 ? '✅' : '❌'}`);
    console.log(`   Rare: ${rare.length} (should be 1,750) ${rare.length === 1750 ? '✅' : '❌'}`);
    console.log(`   Common: ${common.length} (should be 2,500) ${common.length === 2500 ? '✅' : '❌'}`);
    console.log(`   Rare 1-of-1: ${rare1of1.length} (should be 10) ${rare1of1.length === 10 ? '✅' : '❌'}`);
    console.log(`   Legendary 1-of-1: ${legendary1of1.length} (should be 2) ${legendary1of1.length === 2 ? '✅' : '❌'}`);
    console.log(`   Total: ${legendary.length + rare.length + common.length + rare1of1.length + legendary1of1.length} (should be 5,012)\n`);

    if (legendary.length !== 750 || rare.length !== 1750 || common.length !== 2500) {
        console.error('❌ ERROR: Counts do not match! Something went wrong.');
        return;
    }

    // Create final assignments object
    const finalAssignments = {
        common: common,
        rare: rare,
        legendary: legendary,
        rare_1of1: rare1of1,
        legendary_1of1: legendary1of1,
        lastUpdated: new Date().toISOString(),
        summary: {
            common: common.length,
            rare: rare.length,
            legendary: legendary.length,
            rare_1of1: rare1of1.length,
            legendary_1of1: legendary1of1.length
        }
    };

    // Save updated assignments
    await fs.writeFile(
        assignmentsFile,
        JSON.stringify(finalAssignments, null, 2),
        'utf8'
    );

    console.log('✅ Tier assignments saved successfully!\n');

    // Show sample token IDs from each tier
    console.log('📋 Sample Token Assignments:');
    console.log(`\nCommon (first 30): ${common.slice(0, 30).join(', ')}...`);
    console.log(`\nRare (first 30): ${rare.slice(0, 30).join(', ')}...`);
    console.log(`\nLegendary (first 30): ${legendary.slice(0, 30).join(', ')}...`);
    console.log(`\nRare 1-of-1 (all): ${rare1of1.join(', ')}`);
    console.log(`\nLegendary 1-of-1 (all): ${legendary1of1.join(', ')}\n`);

    console.log('🎉 Complete! Now rebuild the rarity cache with:');
    console.log('   POST /api/rarity/rebuild-cache\n');
}

correctTierDistribution().catch(console.error);