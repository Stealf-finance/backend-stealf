/**
 * Middleware de gestion centralisée des erreurs
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Interface pour les erreurs Axios/Grid API
 */
interface GridApiError extends Error {
  response?: {
    status?: number;
    data?: any;
  };
}

/**
 * Middleware de gestion d'erreurs
 * À placer en dernier dans la chaîne de middleware
 */
export const errorHandler = (
  error: GridApiError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Log l'erreur pour debugging
  console.error('❌ Error:', {
    path: req.path,
    method: req.method,
    error: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });

  // Si c'est une erreur de l'API Grid
  if (error.response) {
    return res.status(error.response.status || 500).json({
      error: error.response.data || { message: 'External API error' }
    });
  }

  // Erreur générique
  res.status(500).json({
    error: {
      message: process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : error.message
    }
  });
};

/**
 * Wrapper pour les routes async
 * Évite les try/catch répétés
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
