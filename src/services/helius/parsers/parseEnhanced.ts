import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TokenMetadataService } from '../../token/TokenMetadataService';
import { RawTransaction } from './types';

/**
 * Parse a Helius enhanced API transaction into RawTransaction format.
 * Used by walletInit.ts (GET /v0/addresses/:address/transactions/)
 */
export async function parseEnhancedTransaction(tx: any, walletAddress: string): Promise<RawTransaction> {
    let amount = 0;
    let type: 'sent' | 'received' | 'unknown' = 'unknown';
    let sender = tx.feePayer || '';
    let recipient = '';
    let tokenMint: string | null = null;
    let tokenSymbol = 'SOL';
    let tokenDecimals = 9;

    // Native SOL transfers — compute net delta
    if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
        let netLamports = 0;
        for (const t of tx.nativeTransfers) {
            if (t.toUserAccount === walletAddress) netLamports += (t.amount || 0);
            if (t.fromUserAccount === walletAddress) netLamports -= (t.amount || 0);
        }

        if (netLamports !== 0) {
            amount = Math.abs(netLamports) / LAMPORTS_PER_SOL;
            type = netLamports > 0 ? 'received' : 'sent';

            const directTransfer = tx.nativeTransfers.find(
                (t: any) => t.fromUserAccount === walletAddress || t.toUserAccount === walletAddress
            );
            sender = type === 'received' ? (directTransfer?.fromUserAccount || tx.feePayer || '') : walletAddress;
            recipient = type === 'sent' ? (directTransfer?.toUserAccount || '') : walletAddress;
            tokenMint = null;
            tokenSymbol = 'SOL';
            tokenDecimals = 9;
        }
    }

    // SPL token transfers
    if (type === 'unknown' && tx.tokenTransfers && tx.tokenTransfers.length > 0) {
        const transfer = tx.tokenTransfers.find(
            (t: any) => t.fromUserAccount === walletAddress || t.toUserAccount === walletAddress
        ) || tx.tokenTransfers[0];

        amount = transfer.tokenAmount || 0;
        type = transfer.fromUserAccount === walletAddress ? 'sent' : 'received';
        sender = transfer.fromUserAccount;
        recipient = transfer.toUserAccount;
        tokenMint = transfer.mint || null;

        if (tokenMint) {
            if (transfer.symbol && transfer.symbol !== 'UNKNOWN') {
                tokenSymbol = transfer.symbol;
                tokenDecimals = transfer.decimals || 9;
            } else {
                const meta = await TokenMetadataService.getMetadata(tokenMint);
                tokenSymbol = meta.symbol;
                tokenDecimals = meta.decimals;
            }
        }
    }

    return {
        signature: tx.signature,
        date: tx.timestamp ? new Date(tx.timestamp * 1000) : new Date(),
        status: tx.err ? 'failed' : 'success',
        amount,
        tokenMint,
        tokenSymbol,
        tokenDecimals,
        type,
        sender,
        recipient,
        slot: tx.slot || 0,
    };
}
