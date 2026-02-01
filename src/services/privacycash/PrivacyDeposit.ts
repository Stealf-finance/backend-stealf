import { randomUUID } from 'crypto';
import bs58 from 'bs58';
import { User } from '../../models/User';
import { transferCorrelationService } from './TransferCorrelationService';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { privacyCashService } from './PrivacyCashService';
import { privacyBalanceService } from './PrivacyBalanceService';
import { getSocketService } from '../socket/socketService';
import { CacheService } from '../cache/cacheService';

export interface WebhookTransactionData {
    signature: string;
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
    tokenMint?: string;
    memo?: string;
    timestamp: number;
}

export interface InitiateDepositParams {
    userId: string;
    fromAddress: string;
    amount: number;
    tokenMint?: string;
}

export interface DepositStatus {
    depositId: string;
    reference: string;
    status: string;
    vaultAddress: string;
    amount: number;
    tokenMint?: string;
    transactions?: {
        vaultDepositTx?: string;
        privacyCashDepositTx?: string;
    };
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
}

interface CachedDeposit {
    depositId: string;
    userId: string;
    reference: string;
    sourceWallet: string;
    amount: number;
    tokenMint: string | null;
    status: string;
    retryCount: number;
    vaultDepositTx?: string;
    privacyCashDepositTx?: string;
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
}

export class PrivacyDepositService {
    private get VAULT_ADDRESS(): string {
        const address = process.env.VAULT_PUBLIC_KEY;
        if (!address) {
            throw new Error('VAULT_PUBLIC_KEY not configured');
        }
        return address;
    }

    private socketService = getSocketService();
    private readonly CACHE_TTL = 600;

    private getCacheKey(reference: string): string {
        return `deposit:${reference}`;
    }

    /**
     * Step 1: API initiates deposit (stores in cache with 10min TTL)
     */
    async initiateDeposit(params: InitiateDepositParams): Promise<DepositStatus> {
        const { userId, fromAddress, amount, tokenMint } = params;

        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        if (fromAddress !== user.cash_wallet && fromAddress !== user.stealf_wallet) {
            throw new Error('Invalid fromAddress: must be either your cash_wallet or stealf_wallet');
        }

        if (!privacyCashService.isTokenSupported(tokenMint)) {
            throw new Error(`Token ${tokenMint} is not supported. Supported tokens: SOL, USDC`);
        }

        const reference = randomUUID();
        const depositId = randomUUID();
        const now = new Date();

        const deposit: CachedDeposit = {
            depositId,
            userId,
            reference,
            sourceWallet: fromAddress,
            amount,
            tokenMint: tokenMint || null,
            status: 'pending_vault',
            retryCount: 0,
            createdAt: now,
            updatedAt: now,
        };

        await CacheService.set(this.getCacheKey(reference), deposit, this.CACHE_TTL);

        console.log(`[PrivacyDeposit] Deposit ${depositId} initiated for user ${userId} from ${fromAddress}`);

        return this.formatCachedDepositStatus(deposit);
    }

    /**
     * Step 2: Webhook triggers this via TransferCorrelation
     */
    async processVaultDeposit(transactionSignature: string, reference: string): Promise<void> {
        const deposit = await CacheService.get<CachedDeposit>(this.getCacheKey(reference));

        if (!deposit || deposit.status !== 'pending_vault') {
            console.warn(`[PrivacyDeposit] No matching deposit found for reference ${reference} and tx ${transactionSignature}`);
            return;
        }

        // Step 1: Mark as detected
        deposit.vaultDepositTx = transactionSignature;
        deposit.status = 'vault_tx_detected';
        deposit.updatedAt = new Date();
        await CacheService.set(this.getCacheKey(reference), deposit, this.CACHE_TTL);

        console.log(`[PrivacyDeposit] Vault transaction detected for deposit ${deposit.depositId}`);
        this.notifyDepositUpdate(deposit);

        // Step 2: Mark as received and verified
        deposit.status = 'vault_received';
        deposit.updatedAt = new Date();
        await CacheService.set(this.getCacheKey(reference), deposit, this.CACHE_TTL);

        console.log(`[PrivacyDeposit] Vault deposit verified for deposit ${deposit.depositId}`);
        this.notifyDepositUpdate(deposit);

        // Step 3: Execute Privacy Cash deposit
        await this.executeDeposit(deposit);
    }

    /**
     * Step 3: Execute Privacy Cash deposit
     */
    private async executeDeposit(deposit: CachedDeposit): Promise<void> {
        console.log(`[PrivacyDeposit] Executing deposit for ${deposit.depositId}`);

        try {
            deposit.status = 'deposit_submitted';
            deposit.updatedAt = new Date();
            await CacheService.set(this.getCacheKey(deposit.reference), deposit, this.CACHE_TTL);
            this.notifyDepositUpdate(deposit);

            const mintPubKey = privacyCashService.getTokenMintPublicKey(deposit.tokenMint || undefined);

            let depositResult;
            if (mintPubKey) {
                depositResult = await privacyCashService.depositSPL(mintPubKey, deposit.amount);
            } else {
                depositResult = await privacyCashService.depositSOL(deposit.amount);
            }

            deposit.privacyCashDepositTx = depositResult.tx;
            deposit.status = 'deposited';
            deposit.updatedAt = new Date();
            await CacheService.set(this.getCacheKey(deposit.reference), deposit, this.CACHE_TTL);

            console.log(`[PrivacyDeposit] Deposit completed: ${depositResult.tx}`);
            this.notifyDepositUpdate(deposit);

            await privacyBalanceService.addBalance(
                deposit.userId,
                deposit.amount,
                deposit.tokenMint || undefined
            );

            const updatedBalances = await privacyBalanceService.getAllBalances(deposit.userId);
            this.socketService.emitPrivateBalanceUpdate(deposit.userId, updatedBalances);

            await CacheService.del(this.getCacheKey(deposit.reference));
            console.log(`[PrivacyDeposit] Cache cleaned for deposit ${deposit.depositId}`);

        } catch (error) {
            console.error(`[PrivacyDeposit] Deposit failed for ${deposit.depositId}:`, error);

            deposit.status = 'failed';
            deposit.errorMessage = error instanceof Error ? error.message : 'Unknown error';
            deposit.retryCount += 1;
            deposit.updatedAt = new Date();
            await CacheService.set(this.getCacheKey(deposit.reference), deposit, this.CACHE_TTL);

            this.notifyDepositUpdate(deposit);

            throw error;
        }
    }

    /**
     * Called by TransactionHandler when vault deposit detected
     */
    static async handleVaultDeposit(transaction: any, transfer: any, tokenMint?: string): Promise<void> {
        try {
            console.log('[PrivacyDeposit] Vault deposit detected');

            const signature = transaction.signature;
            const amount = tokenMint ? transfer.tokenAmount : transfer.amount / LAMPORTS_PER_SOL;

            let memo: string | undefined = undefined;

            if (transaction.instructions && Array.isArray(transaction.instructions)) {
                const memoInstruction = transaction.instructions.find((inst: any) =>
                    inst.programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' ||
                    inst.program === 'spl-memo'
                );

                if (memoInstruction) {
                    const memoData = memoInstruction.data || memoInstruction.memo;
                    console.log('[PrivacyDeposit] Raw memo data:', memoData);

                    try {
                        const decoded = bs58.decode(memoData);
                        memo = Buffer.from(decoded).toString('utf-8');
                        console.log('[PrivacyDeposit] Decoded memo from base58:', memo);
                    } catch (error) {
                        memo = memoData;
                        console.log('[PrivacyDeposit] Using raw memo (decoding failed):', memo);
                    }
                }
            }

            if (!memo) {
                console.warn('[PrivacyDeposit] No memo found - cannot correlate deposit');
                return;
            }

            const correlated = await transferCorrelationService.correlateByReference(
                memo,
                amount,
                tokenMint
            );

            if (correlated) {
                console.log('[PrivacyDeposit] Deposit correlated by reference');

                await privacyDepositService.processVaultDeposit(
                    signature,
                    memo
                );
            } else {
                console.log('[PrivacyDeposit] ⚠️ Could not correlate deposit (invalid reference or no matching deposit)');
            }
        } catch (error) {
            console.error('[PrivacyDeposit] Error handling vault deposit:', error);
        }
    }

    private formatCachedDepositStatus(deposit: CachedDeposit): DepositStatus {
        return {
            depositId: deposit.depositId,
            reference: deposit.reference,
            status: deposit.status,
            vaultAddress: this.VAULT_ADDRESS,
            amount: deposit.amount,
            tokenMint: deposit.tokenMint || undefined,
            transactions: {
                vaultDepositTx: deposit.vaultDepositTx,
                privacyCashDepositTx: deposit.privacyCashDepositTx,
            },
            errorMessage: deposit.errorMessage,
            createdAt: deposit.createdAt,
            updatedAt: deposit.updatedAt,
        };
    }

    private notifyDepositUpdate(deposit: CachedDeposit): void {
        this.socketService.emitPrivateTransferUpdate(deposit.userId, {
            transferId: deposit.depositId,
            status: deposit.status,
            amount: deposit.amount,
            tokenMint: deposit.tokenMint || undefined,
            transactions: {
                vaultDepositTx: deposit.vaultDepositTx,
                privacyCashDepositTx: deposit.privacyCashDepositTx,
            },
        });
    }
}

// Export singleton instance
export const privacyDepositService = new PrivacyDepositService();

// Export static method for TransactionHandler
export const handleVaultDeposit = PrivacyDepositService.handleVaultDeposit;