const { Client, Hbar } = require("@hashgraph/sdk");
const fs = require('fs').promises;
const path = require('path');
require("dotenv").config();

class PaymentService {
    constructor() {
        this.client = Client.forTestnet();
        this.client.setOperator(process.env.OPERATOR_ID, process.env.OPERATOR_KEY);
        
        this.treasuryId = process.env.TREASURY_ACCOUNT_ID || process.env.OPERATOR_ID;
        this.pendingPayments = new Map();
        this.confirmedPayments = new Map();
        this.usedTransactionIds = new Set();
        
        console.log(`💰 Payment Service Initialized`);
        console.log(`   Treasury Account: ${this.treasuryId}`);
        
        // Load used transactions from file
        this.loadUsedTransactions();
        
        // Clean up every 5 minutes
        setInterval(() => this.cleanupOldPayments(), 5 * 60 * 1000);
        setInterval(() => this.saveUsedTransactions(), 2 * 60 * 1000);
    }

    /**
     * Generate unique payment ID
     */
    generatePaymentId(userAccountId, rarity) {
        return `${userAccountId}-${rarity}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Initiate payment process
     */
    initiatePayment(userAccountId, rarity, expectedAmount) {
        const paymentId = this.generatePaymentId(userAccountId, rarity);
        
        this.pendingPayments.set(paymentId, {
            userAccountId,
            rarity,
            expectedAmount,
            timestamp: Date.now(),
            status: 'pending',
            attempts: 0
        });

        console.log(`💰 Payment initiated: ${paymentId}`);
        console.log(`   User: ${userAccountId}`);
        console.log(`   Rarity: ${rarity}`);
        console.log(`   Expected: ${expectedAmount.toString()} HBAR`);
        console.log(`   Expected tinybars: ${expectedAmount.toTinybars().toString()}`);
        console.log(`   Treasury: ${this.treasuryId}`);

        return {
            success: true,
            paymentId,
            treasuryAccountId: this.treasuryId,
            expectedAmount: expectedAmount.toString(),
            expectedTinybars: expectedAmount.toTinybars().toString(),
            rarity,
            expiresAt: Date.now() + (10 * 60 * 1000) // 10 minutes
        };
    }

    /**
     * SIMPLIFIED: Verify payment by checking user's last transaction
     */
    async verifyPayment(paymentId) {
        const payment = this.pendingPayments.get(paymentId);
        if (!payment) {
            console.log(`❌ Payment ${paymentId} not found in pending payments`);
            throw new Error('Payment session not found or expired');
        }

        console.log(`\n🔍 VERIFYING PAYMENT:`);
        console.log(`   Payment ID: ${paymentId}`);
        console.log(`   User: ${payment.userAccountId}`);
        console.log(`   Expected: ${payment.expectedAmount.toString()} HBAR to ${this.treasuryId}`);
        console.log(`   Expected tinybars: ${payment.expectedAmount.toTinybars().toString()}`);

        // Check if expired
        if (Date.now() - payment.timestamp > 10 * 60 * 1000) {
            this.pendingPayments.delete(paymentId);
            console.log(`⌛ Payment expired after 10 minutes`);
            throw new Error('Payment session expired (10 minutes)');
        }

        payment.attempts++;
        console.log(`   Attempt: ${payment.attempts}`);

        try {
            // Get user's last transaction from Mirror Node
            console.log(`   Querying Mirror Node for ${payment.userAccountId}...`);
            const userTransaction = await this.getUserLastTransaction(payment.userAccountId);
            
            if (!userTransaction) {
                console.log(`❌ No recent transactions found for ${payment.userAccountId}`);
                return false;
            }

            console.log(`\n📊 FOUND TRANSACTION:`);
            console.log(`   Transaction ID: ${userTransaction.transactionId}`);
            console.log(`   From: ${userTransaction.from}`);
            console.log(`   To: ${userTransaction.to}`);
            console.log(`   Amount: ${userTransaction.amount} tinybars`);
            console.log(`   Timestamp: ${userTransaction.timestamp}`);

            // Convert expected amount to tinybars for comparison
            const expectedTinybars = payment.expectedAmount.toTinybars().toString();
            
            console.log(`\n✅ VERIFICATION CHECKS:`);
            
            // Check 1: Sender matches user
            if (userTransaction.from !== payment.userAccountId) {
                console.log(`❌ Sender mismatch: ${userTransaction.from} ≠ ${payment.userAccountId}`);
                return false;
            }
            console.log(`   ✓ Sender matches: ${userTransaction.from}`);

            // Check 2: Receiver matches our treasury
            if (userTransaction.to !== this.treasuryId) {
                console.log(`❌ Receiver mismatch: ${userTransaction.to} ≠ ${this.treasuryId}`);
                return false;
            }
            console.log(`   ✓ Receiver matches: ${userTransaction.to}`);

            // Check 3: Amount matches expected
            if (userTransaction.amount !== expectedTinybars) {
                console.log(`❌ Amount mismatch:`);
                console.log(`   Found: ${userTransaction.amount} tinybars`);
                console.log(`   Expected: ${expectedTinybars} tinybars`);
                console.log(`   Difference: ${Math.abs(userTransaction.amount - expectedTinybars)}`);
                return false;
            }
            console.log(`   ✓ Amount matches: ${userTransaction.amount} tinybars`);

            // Check 4: Transaction not already used
            if (this.usedTransactionIds.has(userTransaction.transactionId)) {
                console.log(`❌ Transaction already used: ${userTransaction.transactionId}`);
                return false;
            }
            console.log(`   ✓ Transaction is new`);

            // Check 5: Transaction is recent (within last 10 minutes)
            const txTime = new Date(userTransaction.timestamp).getTime();
            const now = Date.now();
            const tenMinutesAgo = now - (10 * 60 * 1000);
            
            if (txTime < tenMinutesAgo) {
                console.log(`❌ Transaction too old: ${new Date(txTime).toISOString()}`);
                console.log(`   Must be after: ${new Date(tenMinutesAgo).toISOString()}`);
                return false;
            }
            console.log(`   ✓ Transaction is recent`);

            console.log(`\n🎉 PAYMENT VERIFIED SUCCESSFULLY!`);

            // Mark transaction as used
            this.usedTransactionIds.add(userTransaction.transactionId);
            
            // Move to confirmed payments
            payment.status = 'confirmed';
            payment.confirmedAt = Date.now();
            payment.transactionId = userTransaction.transactionId;
            payment.actualAmount = userTransaction.amount;
            this.confirmedPayments.set(paymentId, payment);
            this.pendingPayments.delete(paymentId);
            
            // Save used transactions
            await this.saveUsedTransactions();
            
            return true;
            
        } catch (error) {
            console.error(`❌ Payment verification error for ${paymentId}:`, error.message);
            throw new Error(`Payment verification failed: ${error.message}`);
        }
    }

    /**
     * Get user's last transaction from Mirror Node
     */
    async getUserLastTransaction(userAccountId, lookbackMinutes = 10) {
        try {
            const mirrorNodeUrl = `https://testnet.mirrornode.hedera.com/api/v1/transactions`;
            
            const params = new URLSearchParams({
                'account.id': userAccountId,
                'transactiontype': 'CRYPTOTRANSFER',
                'limit': '10',
                'order': 'desc'
            });

            console.log(`   Querying: ${mirrorNodeUrl}?${params}`);
            
            const response = await fetch(`${mirrorNodeUrl}?${params}`);
            if (!response.ok) {
                console.error(`   Mirror node error: ${response.status} ${response.statusText}`);
                throw new Error(`Mirror node error: ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.transactions || data.transactions.length === 0) {
                console.log(`   📭 No transactions found for ${userAccountId}`);
                return null;
            }

            console.log(`   Found ${data.transactions.length} transactions`);
            
            // Parse all transactions and find one to our treasury
            for (const tx of data.transactions) {
                const parsedTx = this.parseTransaction(tx);
                if (parsedTx && parsedTx.to === this.treasuryId) {
                    return parsedTx;
                }
            }
            
            console.log(`   No transactions to treasury found`);
            return null;

        } catch (error) {
            console.error('   Mirror node query failed:', error.message);
            return null;
        }
    }

    /**
     * Parse transaction from mirror node response
     */
    parseTransaction(tx) {
        try {
            if (!tx.transfers || !Array.isArray(tx.transfers)) {
                return null;
            }

            let fromAccount = null;
            let toAccount = null;
            let amount = 0;

            // Find transfers to our treasury
            for (const transfer of tx.transfers) {
                if (transfer.amount > 0 && transfer.account === this.treasuryId) {
                    // Treasury received funds
                    toAccount = transfer.account;
                    amount = transfer.amount;
                    
                    // Find who sent it
                    const sender = tx.transfers.find(t => t.amount < 0);
                    if (sender) {
                        fromAccount = sender.account;
                    }
                    break;
                }
            }

            if (!fromAccount || !toAccount || amount <= 0) {
                return null;
            }

            return {
                transactionId: tx.transaction_id,
                from: fromAccount,
                to: toAccount,
                amount: amount.toString(),
                timestamp: tx.consensus_timestamp,
                memo: tx.memo || ''
            };
        } catch (error) {
            console.error('   Error parsing transaction:', error.message);
            return null;
        }
    }

    /**
     * Get confirmed payment details
     */
    getConfirmedPayment(paymentId) {
        return this.confirmedPayments.get(paymentId);
    }

    /**
     * Remove confirmed payment after minting
     */
    consumePayment(paymentId) {
        if (this.confirmedPayments.has(paymentId)) {
            const payment = this.confirmedPayments.get(paymentId);
            console.log(`🍽️  Consuming payment ${paymentId} for minting`);
            console.log(`   Transaction: ${payment.transactionId}`);
            this.confirmedPayments.delete(paymentId);
            return payment;
        }
        console.log(`❌ Payment ${paymentId} not found in confirmed payments`);
        return null;
    }

    /**
     * Clean up old payments
     */
    cleanupOldPayments() {
        const now = Date.now();
        let cleaned = 0;

        // Clean pending payments older than 10 minutes
        for (const [paymentId, payment] of this.pendingPayments.entries()) {
            if (now - payment.timestamp > 10 * 60 * 1000) {
                this.pendingPayments.delete(paymentId);
                cleaned++;
                console.log(`🧹 Cleaned expired pending payment: ${paymentId}`);
            }
        }

        // Clean confirmed payments older than 1 hour
        for (const [paymentId, payment] of this.confirmedPayments.entries()) {
            if (now - payment.confirmedAt > 60 * 60 * 1000) {
                this.confirmedPayments.delete(paymentId);
                cleaned++;
                console.log(`🧹 Cleaned old confirmed payment: ${paymentId}`);
            }
        }

        if (cleaned > 0) {
            console.log(`🧹 Cleaned up ${cleaned} expired payments`);
        }
    }

    /**
     * Save used transactions to file
     */
    async saveUsedTransactions() {
        try {
            const dataDir = path.join(__dirname, '..', 'data');
            await fs.mkdir(dataDir, { recursive: true });
            
            const dataFile = path.join(dataDir, 'used-transactions.json');
            const data = {
                usedTransactionIds: Array.from(this.usedTransactionIds),
                lastUpdated: new Date().toISOString(),
                count: this.usedTransactionIds.size
            };
            
            await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
            console.log(`💾 Saved ${this.usedTransactionIds.size} used transaction IDs`);
        } catch (error) {
            console.error('Error saving used transactions:', error.message);
        }
    }

    /**
     * Load used transactions from file
     */
    async loadUsedTransactions() {
        try {
            const dataFile = path.join(__dirname, '..', 'data', 'used-transactions.json');
            const data = await fs.readFile(dataFile, 'utf8');
            const parsed = JSON.parse(data);
            
            this.usedTransactionIds = new Set(parsed.usedTransactionIds || []);
            console.log(`✅ Loaded ${this.usedTransactionIds.size} used transaction IDs from file`);
        } catch (error) {
            console.log('ℹ️  No previous transaction history found, starting fresh');
        }
    }

    /**
     * Get payment status
     */
    getPaymentStatus(paymentId) {
        if (this.confirmedPayments.has(paymentId)) {
            const payment = this.confirmedPayments.get(paymentId);
            return { 
                status: 'confirmed', 
                payment: payment,
                message: 'Payment verified and ready for minting'
            };
        }
        if (this.pendingPayments.has(paymentId)) {
            const payment = this.pendingPayments.get(paymentId);
            const timeLeft = Math.max(0, 10 * 60 * 1000 - (Date.now() - payment.timestamp));
            const minutesLeft = Math.ceil(timeLeft / (60 * 1000));
            
            return { 
                status: 'pending', 
                payment: payment,
                message: `Payment pending (${minutesLeft} minutes remaining)`,
                attempts: payment.attempts
            };
        }
        return { 
            status: 'not_found',
            message: 'Payment session not found or expired'
        };
    }

    /**
     * Debug: List all payments
     */
    listAllPayments() {
        console.log('\n📋 PAYMENT STATUS REPORT:');
        console.log('═══════════════════════════════════════');
        
        console.log('📝 Pending Payments:');
        if (this.pendingPayments.size === 0) {
            console.log('   None');
        } else {
            for (const [id, payment] of this.pendingPayments.entries()) {
                const timeAgo = Math.floor((Date.now() - payment.timestamp) / 1000);
                console.log(`   ${id}`);
                console.log(`     User: ${payment.userAccountId}`);
                console.log(`     Amount: ${payment.expectedAmount.toString()}`);
                console.log(`     Created: ${timeAgo} seconds ago`);
                console.log(`     Attempts: ${payment.attempts}`);
            }
        }
        
        console.log('\n✅ Confirmed Payments:');
        if (this.confirmedPayments.size === 0) {
            console.log('   None');
        } else {
            for (const [id, payment] of this.confirmedPayments.entries()) {
                const timeAgo = Math.floor((Date.now() - payment.confirmedAt) / 1000);
                console.log(`   ${id}`);
                console.log(`     User: ${payment.userAccountId}`);
                console.log(`     Amount: ${payment.actualAmount || payment.expectedAmount.toString()}`);
                console.log(`     Transaction: ${payment.transactionId}`);
                console.log(`     Confirmed: ${timeAgo} seconds ago`);
            }
        }
        
        console.log('═══════════════════════════════════════');
        console.log(`Total: ${this.pendingPayments.size + this.confirmedPayments.size} payments`);
        console.log(`Used TXs: ${this.usedTransactionIds.size}`);
    }
}

module.exports = PaymentService;