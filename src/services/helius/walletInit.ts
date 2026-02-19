import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CacheService } from "../cache/cacheService";
import { parseHeliusTransaction } from "../wallet/transactionParser";

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

const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6 },
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', decimals: 6 },
};

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

            // SOL balance
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
            const tokenAccounts = await getConnection().getParsedTokenAccountsByOwner(publicKey, {
                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
            });

            for (const account of tokenAccounts.value) {
                const info = account.account.data.parsed.info;
                const mint: string = info.mint;
                const amount: number = info.tokenAmount.uiAmount || 0;

                if (amount === 0) continue;

                const known = KNOWN_TOKENS[mint];
                const symbol = known?.symbol || 'UNKNOWN';
                const decimals = known?.decimals || info.tokenAmount.decimals;

                let balanceUSD = 0;
                if (symbol === 'USDC' || symbol === 'USDT') {
                    balanceUSD = amount;
                }

                tokens.push({
                    tokenMint: mint,
                    tokenSymbol: symbol,
                    tokenDecimals: decimals,
                    balance: amount,
                    balanceUSD,
                });
            }

            const totalUSD = tokens.reduce((sum, t) => sum + t.balanceUSD, 0);
            const result: WalletBalance = { tokens, totalUSD };

            await CacheService.set(cacheKey, result, 5);

            return result;
        } catch (error) {
            console.error('Error fetching balance:', error);
            throw error;
        }
    },


    async getTransactions(address: string, limit: number = 100): Promise<any[]> {

        const cacheKey = CacheService.historyKey(address, 100);
        const cached = await CacheService.get<any[]>(cacheKey);

        if (cached !== null){
            console.log(`[WalletInit] Returning ${cached.length} transactions from cache`);
            return cached.slice(0, limit);
        }

        try {
            const heliusApiKey = process.env.HELIUS_API_KEY;
            if (!heliusApiKey) {
                throw new Error('HELIUS_API_KEY not found in environment variables');
            }

            console.log(`[WalletInit] Fetching transactions from Helius API for ${address}`);
            const isDevnet = process.env.SOLANA_RPC_URL?.includes('devnet');
            const heliusBase = isDevnet
                ? 'https://api-devnet.helius-rpc.com'
                : 'https://api-mainnet.helius-rpc.com';
            const baseUrl = `${heliusBase}/v0/addresses/${address}/transactions/?api-key=${heliusApiKey}`;
            
            let url = baseUrl;
            let lastSignature: string | null = null;
            let allTransactions: any[] = [];

            while (allTransactions.length < 100) {
                if (lastSignature) {
                    url = baseUrl + `&before=${lastSignature}`;
                }

                const response = await fetch(url);

                if (!response.ok) {
                    console.error(`Helius API error: ${response.status}`);
                    const errorText = await response.text();
                    console.error('Error response:', errorText);
                    break;
                }

                const transactions = await response.json() as any[];

                if (transactions && transactions.length > 0) {
                    allTransactions = [...allTransactions, ...transactions];
                    lastSignature = transactions[transactions.length - 1].signature;

                    if (allTransactions.length >= 100) {
                        allTransactions = allTransactions.slice(0, 100);
                        break;
                    }
                } else {
                    break;
                }
            }

            // Transform Helius transactions to RawTransaction format
            const rawTransactions = allTransactions.map((tx) => parseHeliusTransaction(tx, address));

            await CacheService.set(cacheKey, rawTransactions, 5);
            return rawTransactions.slice(0, limit);

        } catch (error) {
            console.error('Error fetching transactions:', error);
            throw error;
        }
    }
};