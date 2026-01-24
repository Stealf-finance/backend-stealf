import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    console.error('Error:', error);

    if (error.name === 'MongoError' || error.name === 'MongoServerError') {
        const mongoError = error as any;
        if (mongoError.code === 11000) {
            return res.status(409).json({
                error: 'Duplicate entry',
                details: 'Email, pseudo, or sub-org already exists',
            });
        }
    }

    if (error.name === 'ValidationError'){
        return res.status(400).json({
            error: 'Validation failed',
            details: error.message,
        });
    }

    return res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
};