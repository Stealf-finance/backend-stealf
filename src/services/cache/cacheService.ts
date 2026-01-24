import redisClient from '../../config/redis';

export class CacheService {
    static async get<T>(key: string): Promise<T | null> {
        try {
            const cached = await redisClient.get(key);
            if (!cached) return null;
            return JSON.parse(cached) as T;
        } catch (error){
            console.error('Cache get error:', error);
            return null;
        }
    }

    static async set(key: string, value: any, ttlSeconds: number): Promise<void> {
        try{
            if (ttlSeconds === 0) {
                await redisClient.set(key, JSON.stringify(value));
            } else {
                await redisClient.set(
                    key,
                    JSON.stringify(value),
                    'EX',
                    ttlSeconds
                );
            }
        } catch (error) {
            console.error('Cache set error:', error);
        }
    }

    static async del(key: string): Promise<void> {
        try {
            await redisClient.del(key);
        } catch (error) {
            console.error('Cache del error:', error);
        }
    }

    static balanceKey(address: string): string {
        return `wallet:balance:${address}`;
    }

    static historyKey(address: string, limit: number): string {
        return `wallet:history:${address}:${limit}`;
    }
}