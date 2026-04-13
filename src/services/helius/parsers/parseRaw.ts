import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TokenMetadataService } from '../../token/TokenMetadataService';
import { RawTransaction } from './types';

/**
 * Parse a raw Helius webhook transaction into RawTransaction format.
 * Raw format uses preBalances/postBalances and preTokenBalances/postTokenBalances
 * indexed by accountKeys to compute deltas.
 */
export async function parseRawTransaction(tx: any, walletAddress: string): Promise<RawTransaction> {
    let amount = 0;
    let type: 'sent' | 'received' | 'unknown' = 'unknown';
    let sender = '';
    let recipient = '';
    let tokenMint: string | null = null;
    let tokenSymbol = 'SOL';
    let tokenDecimals = 9;

    const accountKeys: string[] = tx.transaction?.message?.accountKeys || [];
    const meta = tx.meta || {};
    const preBalances: number[] = meta.preBalances || [];
    const postBalances: number[] = meta.postBalances || [];
    const walletIndex = accountKeys.indexOf(walletAddress);

    // SOL delta from preBalances/postBalances
    if (walletIndex >= 0) {
        const netLamports = (postBalances[walletIndex] || 0) - (preBalances[walletIndex] || 0);

        if (netLamports !== 0) {
            amount = Math.abs(netLamports) / LAMPORTS_PER_SOL;
            type = netLamports > 0 ? 'received' : 'sent';
            tokenMint = null;
            tokenSymbol = 'SOL';
            tokenDecimals = 9;

            // Counterparty: account with largest opposite delta
            let bestCounterparty = '';
            let bestDelta = 0;
            for (let i = 0; i < accountKeys.length; i++) {
                if (i === walletIndex) continue;
                const delta = (postBalances[i] || 0) - (preBalances[i] || 0);
                if ((netLamports > 0 && delta < bestDelta) || (netLamports < 0 && delta > bestDelta)) {
                    bestDelta = delta;
                    bestCounterparty = accountKeys[i];
                }
            }
            sender = type === 'sent' ? walletAddress : bestCounterparty;
            recipient = type === 'received' ? walletAddress : bestCounterparty;
        }
    }

    // SPL token delta from preTokenBalances/postTokenBalances
    if (type === 'unknown') {
        const preTokenMap = new Map<string, any>();
        const postTokenMap = new Map<string, any>();
        for (const tb of meta.preTokenBalances || []) {
            if (tb.owner === walletAddress) preTokenMap.set(tb.mint, tb);
        }
        for (const tb of meta.postTokenBalances || []) {
            if (tb.owner === walletAddress) postTokenMap.set(tb.mint, tb);
        }

        const allMints = new Set([...preTokenMap.keys(), ...postTokenMap.keys()]);
        for (const mint of allMints) {
            const pre = preTokenMap.get(mint);
            const post = postTokenMap.get(mint);
            const preAmt = pre ? parseInt(pre.uiTokenAmount.amount) : 0;
            const postAmt = post ? parseInt(post.uiTokenAmount.amount) : 0;
            const diff = postAmt - preAmt;

            if (diff !== 0) {
                const dec = post?.uiTokenAmount?.decimals ?? pre?.uiTokenAmount?.decimals ?? 9;
                amount = Math.abs(diff) / Math.pow(10, dec);
                type = diff > 0 ? 'received' : 'sent';
                tokenMint = mint;
                tokenDecimals = dec;

                const tokenMeta = await TokenMetadataService.getMetadata(mint);
                tokenSymbol = tokenMeta.symbol;
                break;
            }
        }
    }

    const signature = tx.transaction?.signatures?.[0] || '';

    return {
        signature,
        date: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date(),
        status: meta.err ? 'failed' : 'success',
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
