import Redis from 'ioredis';

const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);

        return delay;
    },
    maxRetriesPerRequest: 3,
});

redisClient.on('connect', () => {
    console.log('Redis connected');
});

redisClient.on('error', (err) => {
    console.error('Redis error', err);
});

export default redisClient;