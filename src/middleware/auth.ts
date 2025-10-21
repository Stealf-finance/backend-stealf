/**
 * Middleware d'authentification JWT
 * Protège les routes sensibles en vérifiant le token JWT
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Interface pour le payload JWT décodé
 */
export interface JWTPayload {
  email: string;
  address: string;
  grid_user_id: string;
  iat?: number;
  exp?: number;
}

/**
 * Extension de Request pour ajouter les infos utilisateur
 */
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

/**
 * Middleware d'authentification JWT
 * Vérifie le token dans le header Authorization: Bearer <token>
 */
export const authenticateJWT = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'No authorization header provided'
    });
  }

  // Vérifier le format "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      error: 'Invalid token format',
      message: 'Format should be: Authorization: Bearer <token>'
    });
  }

  const token = parts[1];
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    console.error('❌ JWT_SECRET not configured');
    return res.status(500).json({
      error: 'Server configuration error'
    });
  }

  try {
    // Vérifier et décoder le token
    const decoded = jwt.verify(token, jwtSecret) as JWTPayload;

    // Attacher les infos utilisateur à la requête
    req.user = decoded;

    console.log(`✅ JWT authenticated: ${decoded.email} (${decoded.address})`);
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Please login again'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Token verification failed'
      });
    }

    console.error('JWT verification error:', error);
    return res.status(401).json({
      error: 'Authentication failed'
    });
  }
};

/**
 * Middleware optionnel - vérifie le JWT s'il est présent, mais ne bloque pas
 * Utile pour les routes qui peuvent être publiques mais bénéficient d'auth
 */
export const optionalAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    // Pas de token = pas d'auth, mais on continue
    return next();
  }

  // Si token présent, on le vérifie
  authenticateJWT(req, res, next);
};

/**
 * Middleware pour vérifier que l'utilisateur accède à ses propres données
 * À utiliser après authenticateJWT
 */
export const requireOwnResource = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required'
    });
  }

  // Vérifier que l'adresse dans l'URL correspond à celle du user
  const { address } = req.params;

  if (address && address !== req.user.address) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You can only access your own resources'
    });
  }

  next();
};
