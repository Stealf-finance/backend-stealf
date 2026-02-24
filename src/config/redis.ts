import Redis from 'ioredis';
import logger from './logger';

const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);

        return delay;
    },
    maxRetriesPerRequest: 3,
});

redisClient.on('connect', () => {
    logger.info('Redis connected');
});

redisClient.on('error', (err) => {
    logger.error({ err }, 'Redis error');
});

export default redisClient;
