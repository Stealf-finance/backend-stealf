import axios from 'axios';
import redisClient from '../../config/redis';

interface CoinGeckoResponse {
    solana: {
        usd: number;
    };
}

export class SolPriceService {

    private static CACHE_DURATION = 1800; // 30 minutes
    private static CACHE_KEY = 'sol_price';
    private static pendingFetch: Promise<number> | null = null;
    private static lastKnownPrice: number = 140; // in-memory fallback

    /**
     * retrive solana token price
     */
    static async getSolanaPrice(): Promise<number> {
        const cachedPrice = await redisClient.get(this.CACHE_KEY);
        if (cachedPrice) {
            return parseFloat(cachedPrice);
        }

        if (this.pendingFetch) {
            return this.pendingFetch;
        }

        this.pendingFetch = this.fetchAndCache();

        try {
            return await this.pendingFetch;
        } finally {
            this.pendingFetch = null;
        }
    }

    private static async fetchAndCache(): Promise<number> {
        try {
            const COINGECKO_URL = process.env.COINGECKO_URL || '';
            if (!COINGECKO_URL) {
                throw new Error('COINGECKO_URL not defined in environment variables');
            }

            const response = await axios.get<CoinGeckoResponse>(COINGECKO_URL, {
                headers: { 'Accept': 'application/json' },
                timeout: 5000,
            });
            const price = response.data.solana.usd;
            this.lastKnownPrice = price;

            await redisClient.set(
                this.CACHE_KEY,
                price.toString(),
                'EX',
                this.CACHE_DURATION
            );

            return price;
        } catch (error: any) {
            // Rate limited or network error — return last known price silently
            const is429 = error?.response?.status === 429;
            if (!is429) console.error('Error fetching SOL price:', error);

            const fallbackPrice = await redisClient.get(this.CACHE_KEY);
            if (fallbackPrice) return parseFloat(fallbackPrice);

            // Last resort: in-memory price from previous successful fetch
            return this.lastKnownPrice;
        }
    }

    static async clearCache(): Promise<void> {
        await redisClient.del(this.CACHE_KEY);
    }
}
