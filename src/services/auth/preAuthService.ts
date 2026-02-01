import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { CacheService } from '../cache/cacheService';

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
    private static readonly JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    private static readonly TOKEN_EXPIRY = 10 * 60; // 10 minutes en secondes
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

        console.log(`✅ Pre-auth token created for ${email} (session: ${sessionId})`);
        return token;
    }

    static async verifyPreAuthToken(token: string): Promise<PreAuthStatus | null> {
        try {
            const decoded = jwt.verify(token, this.JWT_SECRET) as PreAuthPayload;

            const redisKey = `${this.REDIS_KEY_PREFIX}${decoded.sessionId}`;
            const status = await CacheService.get<PreAuthStatus>(redisKey);

            return status;
        } catch (error) {
            console.error('Invalid pre-auth token:', error);
            return null;
        }
    }

    static async markAsVerified(email: string, pseudo: string): Promise<void> {
        const mappingKey = `${this.REDIS_KEY_PREFIX}mapping:${email}:${pseudo}`;
        const sessionId = await CacheService.get<string>(mappingKey);

        if (!sessionId) {
            console.warn(`No pre-auth session found for ${email}`);
            return;
        }

        const redisKey = `${this.REDIS_KEY_PREFIX}${sessionId}`;
        const status = await CacheService.get<PreAuthStatus>(redisKey);

        if (status) {
            status.verified = true;
            await CacheService.set(redisKey, status, this.TOKEN_EXPIRY);
            console.log(`✅ Pre-auth session marked as verified for ${email}`);
        }
    }

    static async storeSessionMapping(sessionId: string, email: string, pseudo: string): Promise<void> {
        const mappingKey = `${this.REDIS_KEY_PREFIX}mapping:${email}:${pseudo}`;
        await CacheService.set(mappingKey, sessionId, this.TOKEN_EXPIRY);
    }
}