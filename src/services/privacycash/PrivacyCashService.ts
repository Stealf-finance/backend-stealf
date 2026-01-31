import { PublicKey } from '@solana/web3.js';
import { getPrivacyCashClient, calculateWithdrawalFee, SUPPORTED_TOKENS } from '../../config/privacyCash';

export interface DepositResult {
    tx: string;
    amount: number;
    fee: number;
}

export interface WithdrawResult {
    tx: string;
    amount: number;
    fee: number;
}

export interface PrivateBalance {
    amount: number;
    tokenMint?: string;
}

export class PrivacyCashService {
    private get client() {
        return getPrivacyCashClient();
    }

    async depositSOL(amount: number): Promise<DepositResult> {
        try {
            console.log(`[PrivacyCash] Depositing ${amount} SOL`);

            const result = await this.client.deposit({
                lamports: amount,
            });

            return {
                tx: result.tx,
                amount,
                fee: 0,
            };
        } catch (error) {
            console.error('[PrivacyCash] Deposit SOL failed:', error);
            throw new Error(`Privacy Cash deposit failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async depositSPL(mintAddress: PublicKey, amount: number): Promise<DepositResult> {
        try {
            console.log(`[PrivacyCash] Depositing ${amount} tokens for mint ${mintAddress.toBase58()}`);

            const result = await this.client.depositSPL({
                mintAddress,
                amount,
            });

            return {
                tx: result.tx,
                amount,
                fee: 0,
            };
        } catch (error) {
            console.error('[PrivacyCash] Deposit SPL failed:', error);
            throw new Error(`Privacy Cash deposit failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async withdrawSOL(amount: number, recipientAddress: string): Promise<WithdrawResult> {
        try {
            console.log(`[PrivacyCash] Withdrawing ${amount} SOL to ${recipientAddress}`);

            const fee = calculateWithdrawalFee(amount);

            const result = await this.client.withdraw({
                lamports: amount,
                recipientAddress: recipientAddress,
            });

            return {
                tx: result.tx,
                amount,
                fee,
            };
        } catch (error) {
            console.error('[PrivacyCash] Withdraw SOL failed:', error);
            throw new Error(`Privacy Cash withdrawal failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async withdrawSPL(mintAddress: PublicKey, amount: number, recipientAddress: string): Promise<WithdrawResult> {
        try {
            console.log(`[PrivacyCash] Withdrawing ${amount} tokens to ${recipientAddress}`);

            const fee = calculateWithdrawalFee(amount);

            const result = await this.client.withdrawSPL({
                mintAddress,
                amount,
                recipientAddress,
            });

            return {
                tx: result.tx,
                amount,
                fee,
            };
        } catch (error) {
            console.error('[PrivacyCash] Withdraw SPL failed:', error);
            throw new Error(`Privacy Cash withdrawal failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async getPrivateBalanceSOL(): Promise<PrivateBalance> {
        try {
            const balance = await this.client.getPrivateBalance();
            return {
                amount: balance.lamports,
            };
        } catch (error) {
            console.error('[PrivacyCash] Get SOL balance failed:', error);
            throw new Error(`Failed to get private balance: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async getPrivateBalanceSPL(mintAddress: PublicKey): Promise<PrivateBalance> {
        try {
            const balance = await this.client.getPrivateBalanceSpl(mintAddress);
            return {
                amount: balance.amount,
                tokenMint: mintAddress.toBase58(),
            };
        } catch (error) {
            console.error('[PrivacyCash] Get SPL balance failed:', error);
            throw new Error(`Failed to get private balance: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async getAllBalances(): Promise<{ sol: number; usdc: number }> {
        try {
            const solBalance = await this.getPrivateBalanceSOL();
            const usdcBalance = await this.getPrivateBalanceSPL(SUPPORTED_TOKENS.USDC);

            return {
                sol: solBalance.amount,
                usdc: usdcBalance.amount,
            };
        } catch (error) {
            console.error('[PrivacyCash] Get all balances failed:', error);
            throw new Error(`Failed to get balances: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    isTokenSupported(tokenMint?: string): boolean {
        if (!tokenMint) return true;

        return Object.values(SUPPORTED_TOKENS).some(
            supportedMint => supportedMint?.toBase58() === tokenMint
        );
    }

    getTokenMintPublicKey(tokenMint?: string): PublicKey | null {
        if (!tokenMint) return null;

        if (tokenMint === SUPPORTED_TOKENS.USDC.toBase58()) {
            return SUPPORTED_TOKENS.USDC;
        }

        return null;
    }
}

export const privacyCashService = new PrivacyCashService();
