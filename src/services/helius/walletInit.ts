import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CacheService } from "../cache/cacheService";
import { parseEnhancedTransaction } from "./parsers/parseEnhanced";
import { TokenMetadataService } from "../token/TokenMetadataService";
import logger from "../../config/logger";

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

let _connection: Connection | null = null;
function getConnection(): Connection {
    if (!_connection) {
        const rpc = process.env.SOLANA_RPC_URL;
        if (!rpc) throw new Error('SOLANA_RPC_URL is not defined');
        _connection = new Connection(rpc, 'confirmed');
    }
    return _connection;
}


export interface TokenBalance {
    tokenMint: string | null;
    tokenSymbol: string;
    tokenDecimals: number;
    balance: number;
    balanceUSD: number;
}

export interface WalletBalance {
    tokens: TokenBalance[];
    totalUSD: number;
}

export const solanaService = {

    async getBalance(walletAddress: string): Promise<WalletBalance> {

        const cacheKey = CacheService.balanceKey(walletAddress);
        const cached = await CacheService.get<WalletBalance>(cacheKey);

        if (cached !== null) {
            return cached;
        }

        try {
            const publicKey = new PublicKey(walletAddress);
            const { SolPriceService } = await import('../pricing/solPrice');
            const solPrice = await SolPriceService.getSolanaPrice();

            const balanceInLamports = await getConnection().getBalance(publicKey);
            const balanceInSOL = balanceInLamports / LAMPORTS_PER_SOL;

            const tokens: TokenBalance[] = [{
                tokenMint: null,
                tokenSymbol: 'SOL',
                tokenDecimals: 9,
                balance: balanceInSOL,
                balanceUSD: balanceInSOL * solPrice,
            }];

            // SPL token balances
            const [tokenAccounts, token2022Accounts] = await Promise.all([
                getConnection().getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
                getConnection().getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
            ]);

            const allAccounts = [...tokenAccounts.value, ...token2022Accounts.value];

            const nonZeroAccounts: { mint: string; amount: number; decimals: number }[] = [];
            for (const account of allAccounts) {
                const info = account.account.data.parsed.info;
                const mint: string = info.mint;
                const amount: number = info.tokenAmount.uiAmount || 0;
                if (amount === 0) continue;
                nonZeroAccounts.push({ mint, amount, decimals: info.tokenAmount.decimals });
            }

            const mints = nonZeroAccounts.map(a => a.mint);
            const metadataMap = mints.length > 0
                ? await TokenMetadataService.getMetadataBatch(mints)
                : new Map();

            for (const { mint, amount, decimals } of nonZeroAccounts) {
                const meta = metadataMap.get(mint);
                const symbol = meta?.symbol || 'UNKNOWN';

                let balanceUSD = 0;
                if (symbol === 'USDC' || symbol === 'USDT') {
                    balanceUSD = amount;
                }

                tokens.push({
                    tokenMint: mint,
                    tokenSymbol: symbol,
                    tokenDecimals: meta?.decimals ?? decimals,
                    balance: amount,
                    balanceUSD,
                });
            }

            const totalUSD = tokens.reduce((sum, t) => sum + t.balanceUSD, 0);
            const result: WalletBalance = { tokens, totalUSD };

            await CacheService.set(cacheKey, result, 300);

            return result;
        } catch (error) {
            logger.error({ err: error }, 'Error fetching balance');
            throw error;
        }
    },


    async getTransactions(address: string, limit: number = 200): Promise<any[]> {

        const cacheKey = CacheService.historyKey(address, 200);
        const cached = await CacheService.get<any[]>(cacheKey);

        if (cached !== null){
            logger.debug({ count: cached.length }, 'WalletInit: returning transactions from cache');
            return cached.slice(0, limit);
        }

        // Try Helius enhanced API first, retry once, then fallback to RPC
        const heliusTxs = await this.fetchFromHelius(address);
        if (heliusTxs !== null) {
            const rawTransactions = await Promise.all(
                heliusTxs.map((tx) => parseEnhancedTransaction(tx, address))
            );
            await CacheService.set(cacheKey, rawTransactions, 300);
            return rawTransactions.slice(0, limit);
        }

        // Fallback: Solana RPC
        logger.warn({ address }, 'Helius API failed, falling back to RPC');
        const rpcTxs = await this.fetchFromRpc(address, limit);
        if (rpcTxs.length > 0) {
            await CacheService.set(cacheKey, rpcTxs, 300);
        }
        return rpcTxs.slice(0, limit);
    },

    async fetchFromHelius(address: string): Promise<any[] | null> {
        const heliusApiKey = process.env.HELIUS_API_KEY;
        if (!heliusApiKey) return null;

        const isDevnet = process.env.SOLANA_RPC_URL?.includes('devnet');
        const heliusBase = isDevnet
            ? 'https://api-devnet.helius.xyz'
            : 'https://api.helius.xyz';
        const baseUrl = `${heliusBase}/v0/addresses/${address}/transactions/?api-key=${heliusApiKey}`;

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                let url = baseUrl;
                let lastSignature: string | null = null;
                let allTransactions: any[] = [];

                while (allTransactions.length < 200) {
                    if (lastSignature) {
                        url = baseUrl + `&before=${lastSignature}`;
                    }

                    const response = await fetch(url);

                    if (!response.ok) {
                        const errorText = await response.text();
                        logger.error({ status: response.status, body: errorText, attempt }, 'Helius API error');
                        throw new Error(`Helius ${response.status}`);
                    }

                    const transactions = await response.json() as any[];

                    if (transactions && transactions.length > 0) {
                        allTransactions = [...allTransactions, ...transactions];
                        lastSignature = transactions[transactions.length - 1].signature;

                        if (allTransactions.length >= 200) {
                            allTransactions = allTransactions.slice(0, 200);
                            break;
                        }
                    } else {
                        break;
                    }
                }

                return allTransactions;
            } catch (error) {
                if (attempt === 0) {
                    logger.debug('Retrying Helius API...');
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }
        return null;
    },

    async fetchFromRpc(address: string, limit: number): Promise<any[]> {
        try {
            const publicKey = new PublicKey(address);
            const signatures = await getConnection().getSignaturesForAddress(publicKey, { limit });

            const txs = await Promise.all(
                signatures.map(async (sig) => {
                    try {
                        const tx = await getConnection().getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 });
                        if (!tx) return null;

                        // Build a RawTransaction from parsed RPC data
                        const accountKeys = tx.transaction.message.accountKeys.map(k => k.pubkey.toString());
                        const walletIndex = accountKeys.indexOf(address);
                        let amount = 0;
                        let type: 'sent' | 'received' | 'unknown' = 'unknown';
                        let sender = '';
                        let recipient = '';

                        if (walletIndex >= 0 && tx.meta) {
                            const delta = (tx.meta.postBalances[walletIndex] || 0) - (tx.meta.preBalances[walletIndex] || 0);
                            if (delta !== 0) {
                                amount = Math.abs(delta) / LAMPORTS_PER_SOL;
                                type = delta > 0 ? 'received' : 'sent';
                                sender = type === 'sent' ? address : '';
                                recipient = type === 'received' ? address : '';
                            }
                        }

                        return {
                            signature: sig.signature,
                            date: sig.blockTime ? new Date(sig.blockTime * 1000) : new Date(),
                            status: tx.meta?.err ? 'failed' : 'success',
                            amount,
                            tokenMint: null,
                            tokenSymbol: 'SOL',
                            tokenDecimals: 9,
                            type,
                            sender,
                            recipient,
                            slot: sig.slot || 0,
                        };
                    } catch {
                        return null;
                    }
                })
            );

            return txs.filter(Boolean) as any[];
        } catch (error) {
            logger.error({ err: error }, 'RPC fallback failed');
            return [];
        }
    }
};
