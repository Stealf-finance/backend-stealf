
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import bs58 from 'bs58';
import { PrivateDeposit, IPrivateDeposit } from '../../models/PrivateDeposit';
import { User } from '../../models/User';
import { transferCorrelationService } from './TransferCorrelationService';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { privacyCashService } from './PrivacyCashService';
import { privacyBalanceService } from './PrivacyBalanceService';
import { getSocketService } from '../socket/socketService';

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

export class PrivacyDepositService {
    private get VAULT_ADDRESS(): string {
        const address = process.env.VAULT_PUBLIC_KEY;
        if (!address) {
            throw new Error('VAULT_PUBLIC_KEY not configured');
        }
        return address;
    }

    private socketService = getSocketService();

    /**
     * Step 1: API initiates deposit (creates DB record)
     */
    async initiateDeposit(params: InitiateDepositParams): Promise<DepositStatus> {
        const { userId, fromAddress, amount, tokenMint } = params;

        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Verify that fromAddress belongs to the user
        if (fromAddress !== user.cash_wallet && fromAddress !== user.stealf_wallet) {
            throw new Error('Invalid fromAddress: must be either your cash_wallet or stealf_wallet');
        }

        if (!privacyCashService.isTokenSupported(tokenMint)) {
            throw new Error(`Token ${tokenMint} is not supported. Supported tokens: SOL, USDC`);
        }

        const reference = randomUUID();

        const deposit = new PrivateDeposit({
            userId: new mongoose.Types.ObjectId(userId),
            reference,
            sourceWallet: fromAddress,
            amount,
            tokenMint: tokenMint || null,
            status: 'pending_vault',
            retryCount: 0,
        });

        await deposit.save();

        console.log(`[PrivacyDeposit] Deposit ${deposit._id} initiated for user ${userId} from ${fromAddress}`);

        return this.formatDepositStatus(deposit);
    }

    /**
     * Step 2: Webhook triggers this via TransferCorrelation
     */
    async processVaultDeposit(transactionSignature: string, reference: string): Promise<void> {
        const deposit = await PrivateDeposit.findOne({
            status: 'pending_vault',
            reference,
        });

        if (!deposit) {
            console.warn(`[PrivacyDeposit] No matching deposit found for reference ${reference} and tx ${transactionSignature}`);
            return;
        }

        // Step 1: Mark as detected
        deposit.vaultDepositTx = transactionSignature;
        deposit.status = 'vault_tx_detected';
        await deposit.save();

        console.log(`[PrivacyDeposit] Vault transaction detected for deposit ${deposit._id}`);
        this.notifyDepositUpdate(deposit);

        // Step 2: Mark as received and verified
        deposit.status = 'vault_received';
        await deposit.save();

        console.log(`[PrivacyDeposit] Vault deposit verified for deposit ${deposit._id}`);
        this.notifyDepositUpdate(deposit);

        // Step 3: Execute Privacy Cash deposit
        await this.executeDeposit(deposit);
    }

    /**
     * Step 3: Execute Privacy Cash deposit
     */
    private async executeDeposit(deposit: IPrivateDeposit): Promise<void> {
        console.log(`[PrivacyDeposit] Executing deposit for ${deposit._id}`);

        try {
            // Step 1: Mark as submitted
            deposit.status = 'deposit_submitted';
            await deposit.save();
            this.notifyDepositUpdate(deposit);

            const mintPubKey = privacyCashService.getTokenMintPublicKey(deposit.tokenMint || undefined);

            let depositResult;
            if (mintPubKey) {
                depositResult = await privacyCashService.depositSPL(mintPubKey, deposit.amount);
            } else {
                depositResult = await privacyCashService.depositSOL(deposit.amount);
            }

            // Step 2: Mark as deposited
            deposit.privacyCashDepositTx = depositResult.tx;
            deposit.status = 'deposited';
            await deposit.save();

            console.log(`[PrivacyDeposit] Deposit completed: ${depositResult.tx}`);
            this.notifyDepositUpdate(deposit);

            // Update user's private balance
            await privacyBalanceService.addBalance(
                deposit.userId.toString(),
                deposit.amount,
                deposit.tokenMint || undefined
            );

        } catch (error) {
            console.error(`[PrivacyDeposit] Deposit failed for ${deposit._id}:`, error);

            deposit.status = 'failed';
            deposit.errorMessage = error instanceof Error ? error.message : 'Unknown error';
            deposit.retryCount += 1;
            await deposit.save();

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

            // Check if we already processed this transaction (Helius sends duplicates)
            const existingDeposit = await PrivateDeposit.findOne({ vaultDepositTx: signature });
            if (existingDeposit) {
                console.log(`[PrivacyDeposit] Transaction ${signature} already processed for deposit ${existingDeposit._id}, skipping`);
                return;
            }

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

    private formatDepositStatus(deposit: IPrivateDeposit): DepositStatus {
        return {
            depositId: deposit._id.toString(),
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

    private notifyDepositUpdate(deposit: IPrivateDeposit): void {
        this.socketService.emitPrivateTransferUpdate(deposit.userId.toString(), {
            transferId: deposit._id.toString(),
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