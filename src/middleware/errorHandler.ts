import { Request, Response, NextFunction } from 'express';
import { Sentry, sentryEnabled } from '../config/sentry';
import logger from '../config/logger';

const isDevelopment = process.env.NODE_ENV === 'development';

export const errorHandler = (
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    logger.error({ err: error, path: req.path, method: req.method }, 'Unhandled error');

    if (sentryEnabled) {
        Sentry.captureException(error);
    }

    if (error.name === 'MongoError' || error.name === 'MongoServerError') {
        const mongoError = error as any;
        if (mongoError.code === 11000) {
            return res.status(409).json({
                error: 'Duplicate entry',
                details: 'A record with these details already exists',
            });
        }
    }

    if (error.name === 'ValidationError'){
        return res.status(400).json({
            error: 'Validation failed',
            details: isDevelopment ? error.message : 'Invalid input data',
        });
    }

    return res.status(500).json({
        error: 'Internal server error',
        ...(isDevelopment && { message: error.message }),
    });
};
