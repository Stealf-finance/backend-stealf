import { Socket } from 'socket.io';
import { verifySessionJwtSignature } from "@turnkey/crypto";
import jwt from "jsonwebtoken";
import { User } from '../models/User';
import { decodeSessionJwt } from './verifyAuth';

const WALLET_JWT_SECRET = process.env.WALLET_JWT_SECRET || "stealf-wallet-auth-secret-change-in-production";

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

        if (!token) {
            return next(new Error('Authentification error: No token provided'));
        }

        // Try wallet JWT first (signed with WALLET_JWT_SECRET)
        try {
            const walletPayload = jwt.verify(token, WALLET_JWT_SECRET) as {
                mongoUserId: string;
                organizationId: string;
                authMethod: string;
            };

            if (walletPayload.authMethod === "wallet" && walletPayload.mongoUserId) {
                const user = await User.findById(walletPayload.mongoUserId);
                if (!user) {
                    return next(new Error('Authentification error: User not found'));
                }

                socket.user = {
                    sessionType: "wallet",
                    userId: walletPayload.mongoUserId,
                    organizationId: walletPayload.organizationId,
                    expiry: 0,
                    publicKey: user.stealf_wallet || user.cash_wallet || "",
                };

                return next();
            }
        } catch {
            // Not a wallet JWT — fall through to Turnkey verification
        }

        // Turnkey session JWT (passkey users)
        const isValid = await verifySessionJwtSignature(token);
        if (!isValid) {
            return next(new Error('Authentification error: Invalid JWT signature'));
        }

        const decoded = decodeSessionJwt(token);

        const now = Math.floor(Date.now() / 1000);
        if (decoded.expiry < now) {
            return next(new Error('Authentification error: JWT expired'));
        }

        socket.user = decoded;

        next();
    } catch (error) {
        console.error('Socket authentification error:', error);
        return next(new Error('Authentication failed'));
    }
}
