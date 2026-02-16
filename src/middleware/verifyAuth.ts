import { Request, Response, NextFunction } from 'express';
import { verifySessionJwtSignature } from "@turnkey/crypto";
import jwt from "jsonwebtoken";
import { User } from '../models/User';

const WALLET_JWT_SECRET = process.env.WALLET_JWT_SECRET || "stealf-wallet-auth-secret-change-in-production";

declare global {
    namespace Express {
        interface Request {
            user?: {
                sessionType: string;
                userId: string;
                organizationId: string;
                expiry: number;
                publicKey: string;
                mongoUserId?: string; // MongoDB ObjectId
            };
        }
    }
}

export function decodeSessionJwt(token: string): {
    sessionType: string;
    userId: string;
    organizationId: string;
    expiry: number;
    publicKey: string;
  } {
    const [, payload] = token.split(".");
    if (!payload) {
      throw new Error("Invalid JWT: Missing payload");
    }

    const decoded = JSON.parse(atob(payload));
    const {
      exp,
      public_key: publicKey,
      session_type: sessionType,
      user_id: userId,
      organization_id: organizationId,
    } = decoded;

    if (!exp || !publicKey || !sessionType || !userId || !organizationId) {
      throw new Error("JWT payload missing required fields");
    }

    return {
      sessionType,
      userId,
      organizationId,
      expiry: exp,
      publicKey,
    };
}

export async function verifyAuth(req: Request, res: Response, next: NextFunction) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid authorization header' });
        }
        const token = authHeader.substring(7);

        // Try wallet JWT first (signed with our secret)
        try {
            const walletPayload = jwt.verify(token, WALLET_JWT_SECRET) as {
                mongoUserId: string;
                organizationId: string;
                authMethod: string;
            };

            if (walletPayload.authMethod === "wallet" && walletPayload.mongoUserId) {
                const user = await User.findById(walletPayload.mongoUserId);
                if (!user) {
                    return res.status(401).json({ error: 'User not found' });
                }

                req.user = {
                    sessionType: "wallet",
                    userId: walletPayload.mongoUserId,
                    organizationId: walletPayload.organizationId,
                    expiry: 0,
                    publicKey: "",
                    mongoUserId: walletPayload.mongoUserId,
                };

                return next();
            }
        } catch {
            // Not a wallet JWT, try Turnkey JWT below
        }

        // Turnkey session JWT (passkey users)
        const isValid = await verifySessionJwtSignature(token);
        if (!isValid){
            return res.status(401).json({ error: 'Invalid JWT signature' });
        }

        const decoded = decodeSessionJwt(token);
        const now = Math.floor(Date.now() / 1000);
        if (decoded.expiry < now){
            return res.status(401).json({ error: 'JWT expired' });
        }

        const userExist = await User.findOne({ turnkey_subOrgId: decoded.organizationId });
        if (!userExist){
            return res.status(401).json({ error: 'User not found' });
        }

        req.user = {
            ...decoded,
            mongoUserId: userExist._id.toString(),
        };

        next();

    } catch (error) {
        console.error('Auth verification error:', error);
        return res.status(401).json({ error: 'Authentification failed' });
    }
}
