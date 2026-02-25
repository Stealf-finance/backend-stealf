import { Socket } from 'socket.io';
import { verifySessionJwtSignature } from "@turnkey/crypto";
import { User } from '../models/User';
import { decodeSessionJwt } from './verifyAuth';
import logger from '../config/logger';

declare module 'socket.io' {
    interface Socket {
        user?: {
            sessionType: string;
            userId: string;
            organizationId: string;
            expiry: number;
            publicKey: string;
        };
    }
}

export async function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void) {
    try {
        const token = socket.handshake.auth?.token;

        if (!token){
            return next(new Error('Authentification error: No token provided'));
        }

        const isValid = await verifySessionJwtSignature(token);
        if (!isValid){
            return next(new Error('Authentification error: Invalid JWT signature'));
        }

        const decoded = decodeSessionJwt(token);

        const now = Math.floor(Date.now() / 1000);
        if (decoded.expiry < now){
            return next(new Error('Authentification error: JWT expired'));
        }

        // Verify user still exists in database (prevents deleted users from connecting)
        const user = await User.findOne({ turnkey_subOrgId: decoded.organizationId });
        if (!user) {
            return next(new Error('Authentication error: User not found'));
        }

        socket.user = decoded;

        next();
    } catch (error) {
        logger.error({ err: error }, 'Socket authentication error');
        return next(new Error('Authentication failed'));
    }

}
