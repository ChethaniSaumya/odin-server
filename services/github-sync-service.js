const { updateFileOnGitHub } = require('./githubHelper');

class GitHubSyncService {
    constructor() {
        this.maxRetries = 3;
        this.retryDelay = 2000;
    }

    async syncFile(filePath, content, commitMessage) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`🔄 GitHub sync attempt ${attempt}/${this.maxRetries} for ${filePath}`);
                
                await updateFileOnGitHub(filePath, content, commitMessage);
                
                console.log(`✅ GitHub sync successful: ${filePath}`);
                return true;
                
            } catch (error) {
                lastError = error;
                console.error(`❌ GitHub sync attempt ${attempt} failed:`, error.message);
                
                if (attempt < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
            }
        }
        
        console.error(`🚨 All GitHub sync attempts failed for ${filePath}:`, lastError.message);
        return false;
    }

    async syncMintedTracker(content) {
        return this.syncFile(
            'services/data/minted-tracker.json',
            content,
            `Update minted tracker: ${new Date().toISOString()}`
        );
    }

    async syncClaimedWallets(content) {
        return this.syncFile(
            'data/claimed-wallets.json',
            content,
            `Update claimed wallets: ${new Date().toISOString()}`
        );
    }

    async syncMintRecords(content) {
        return this.syncFile(
            'data/mint-records.json',
            content,
            `Update mint records: ${new Date().toISOString()}`
        );
    }

    async syncUsedTransactions(content) {
        return this.syncFile(
            'data/used-transactions.json',
            content,
            `Update used transactions: ${new Date().toISOString()}`
        );
    }
}

module.exports = new GitHubSyncService();