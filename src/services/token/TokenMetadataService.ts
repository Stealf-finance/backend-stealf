import { CacheService } from '../cache/cacheService';

export interface TokenMetadata {
    symbol: string;
    decimals: number;
    name: string;
}

const CACHE_TTL = 86400; // 24h
const CACHE_PREFIX = 'token:meta:';
const JUPITER_TOKEN_API = 'https://api.jup.ag/tokens/v2/search';  // ?query={mint}

// Well-known tokens that never change — avoids unnecessary API calls
const WELL_KNOWN: Record<string, TokenMetadata> = {
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', decimals: 6, name: 'Tether USD' },
    'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9, name: 'Wrapped SOL' },
};

const UNKNOWN_TOKEN: TokenMetadata = { symbol: 'UNKNOWN', decimals: 9, name: 'Unknown Token' };

export class TokenMetadataService {
    private static inFlight = new Map<string, Promise<TokenMetadata>>();

    static async getMetadata(mint: string): Promise<TokenMetadata> {
        // 1. Well-known shortcut
        const wellKnown = WELL_KNOWN[mint];
        if (wellKnown) return wellKnown;

        // 2. Redis cache
        const cached = await CacheService.get<TokenMetadata>(`${CACHE_PREFIX}${mint}`);
        if (cached) return cached;

        // 3. Deduplicate concurrent fetches for the same mint
        const existing = this.inFlight.get(mint);
        if (existing) return existing;

        const promise = this.fetchSingle(mint);
        this.inFlight.set(mint, promise);
        try {
            return await promise;
        } finally {
            this.inFlight.delete(mint);
        }
    }

    static async getMetadataBatch(mints: string[]): Promise<Map<string, TokenMetadata>> {
        const result = new Map<string, TokenMetadata>();
        const toFetch: string[] = [];

        // 1. Resolve well-known + cached
        for (const mint of mints) {
            const wellKnown = WELL_KNOWN[mint];
            if (wellKnown) {
                result.set(mint, wellKnown);
                continue;
            }
            const cached = await CacheService.get<TokenMetadata>(`${CACHE_PREFIX}${mint}`);
            if (cached) {
                result.set(mint, cached);
                continue;
            }
            toFetch.push(mint);
        }

        if (toFetch.length === 0) return result;

        // 2. Batch fetch from Jupiter (max 100 per request)
        for (let i = 0; i < toFetch.length; i += 100) {
            const batch = toFetch.slice(i, i + 100);
            const fetched = await this.fetchBatch(batch);
            for (const [mint, meta] of fetched) {
                result.set(mint, meta);
            }
        }

        // 3. Fill remaining with UNKNOWN
        for (const mint of toFetch) {
            if (!result.has(mint)) {
                result.set(mint, UNKNOWN_TOKEN);
                await CacheService.set(`${CACHE_PREFIX}${mint}`, UNKNOWN_TOKEN, CACHE_TTL);
            }
        }

        return result;
    }

    private static async fetchSingle(mint: string): Promise<TokenMetadata> {
        try {
            const apiKey = process.env.JUPITER_API_KEY;
            if (!apiKey) {
                await CacheService.set(`${CACHE_PREFIX}${mint}`, UNKNOWN_TOKEN, CACHE_TTL);
                return UNKNOWN_TOKEN;
            }

            const response = await fetch(`${JUPITER_TOKEN_API}?query=${mint}`, {
                headers: { 'x-api-key': apiKey },
            });

            if (!response.ok) {
                await CacheService.set(`${CACHE_PREFIX}${mint}`, UNKNOWN_TOKEN, CACHE_TTL);
                return UNKNOWN_TOKEN;
            }

            const data = await response.json() as any[];

            // Search returns an array — find exact mint match
            const token = Array.isArray(data)
                ? data.find((t: any) => t.address === mint)
                : null;

            if (!token) {
                await CacheService.set(`${CACHE_PREFIX}${mint}`, UNKNOWN_TOKEN, CACHE_TTL);
                return UNKNOWN_TOKEN;
            }

            const meta: TokenMetadata = {
                symbol: token.symbol || 'UNKNOWN',
                decimals: token.decimals ?? 9,
                name: token.name || 'Unknown Token',
            };

            await CacheService.set(`${CACHE_PREFIX}${mint}`, meta, CACHE_TTL);
            return meta;
        } catch {
            await CacheService.set(`${CACHE_PREFIX}${mint}`, UNKNOWN_TOKEN, CACHE_TTL);
            return UNKNOWN_TOKEN;
        }
    }

    private static async fetchBatch(mints: string[]): Promise<Map<string, TokenMetadata>> {
        const result = new Map<string, TokenMetadata>();
        try {
            const apiKey = process.env.JUPITER_API_KEY;
            if (!apiKey) return result;

            // V2 search endpoint accepts comma-separated mint addresses (max 100)
            const query = mints.join(',');
            const response = await fetch(`${JUPITER_TOKEN_API}?query=${query}`, {
                headers: { 'x-api-key': apiKey },
            });

            if (!response.ok) return result;

            const data = await response.json() as any[];
            if (!Array.isArray(data)) return result;

            for (const token of data) {
                if (!token.address) continue;
                const meta: TokenMetadata = {
                    symbol: token.symbol || 'UNKNOWN',
                    decimals: token.decimals ?? 9,
                    name: token.name || 'Unknown Token',
                };
                result.set(token.address, meta);
                await CacheService.set(`${CACHE_PREFIX}${token.address}`, meta, CACHE_TTL);
            }
        } catch {
            // Silently fail — callers will fill with UNKNOWN
        }
        return result;
    }
}
