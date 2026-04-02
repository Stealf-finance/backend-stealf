import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { CacheService } from '../cache/cacheService';
import redisClient from '../../config/redis';
import logger from '../../config/logger';

interface PreAuthPayload {
    sessionId: string;
    email: string;
    pseudo: string;
}

interface PreAuthStatus {
    email: string;
    pseudo: string;
    verified: boolean;
    createdAt: Date;
}

export class PreAuthService {
    private static readonly JWT_SECRET = process.env.JWT_SECRET!;
    private static readonly TOKEN_EXPIRY = 10 * 60; // 10 minutes in secondes
    private static readonly REDIS_KEY_PREFIX = 'preauth:';

    static async createPreAuthToken(email: string, pseudo: string): Promise<string> {
        const sessionId = uuidv4();

        const payload: PreAuthPayload = {
            sessionId,
            email,
            pseudo
        };

        const token = jwt.sign(payload, this.JWT_SECRET, {
            expiresIn: `${this.TOKEN_EXPIRY}s`
        });
        const redisKey = `${this.REDIS_KEY_PREFIX}${sessionId}`;
        const statusData: PreAuthStatus = {
            email,
            pseudo,
            verified: false,
            createdAt: new Date()
        };

        await CacheService.set(redisKey, statusData, this.TOKEN_EXPIRY);

        await this.storeSessionMapping(sessionId, email, pseudo);

        logger.debug({ sessionId }, 'Pre-auth token created');
        return token;
    }

    static async verifyPreAuthToken(token: string): Promise<PreAuthStatus | null> {
        try {
            const decoded = jwt.verify(token, this.JWT_SECRET) as PreAuthPayload;

            const redisKey = `${this.REDIS_KEY_PREFIX}${decoded.sessionId}`;
            const status = await CacheService.get<PreAuthStatus>(redisKey);

            return status;
        } catch (error) {
            logger.error({ err: error }, 'Invalid pre-auth token');
            return null;
        }
    }

    static async markAsVerified(email: string, pseudo: string): Promise<void> {
        const mappingKey = `${this.REDIS_KEY_PREFIX}mapping:${email}:${pseudo}`;
        const sessionId = await CacheService.get<string>(mappingKey);

        if (!sessionId) {
            logger.warn('No pre-auth session found');
            return;
        }

        const redisKey = `${this.REDIS_KEY_PREFIX}${sessionId}`;
        await redisClient.watch(redisKey);
        const raw = await redisClient.get(redisKey);
        if (!raw) {
            await redisClient.unwatch();
            return;
        }
        const status: PreAuthStatus = JSON.parse(raw);
        status.verified = true;
        const multi = redisClient.multi();
        multi.set(redisKey, JSON.stringify(status), 'EX', this.TOKEN_EXPIRY);
        const txResult = await multi.exec();
        if (txResult) {
            logger.debug('Pre-auth session marked as verified');
        } else {
            logger.warn('Pre-auth verification concurrent update detected');
        }
    }

    static async storeSessionMapping(sessionId: string, email: string, pseudo: string): Promise<void> {
        const mappingKey = `${this.REDIS_KEY_PREFIX}mapping:${email}:${pseudo}`;
        await CacheService.set(mappingKey, sessionId, this.TOKEN_EXPIRY);
    }
}
