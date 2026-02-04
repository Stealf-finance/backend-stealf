import { Request, Response, NextFunction } from 'express';

// SECURITY: Default to production mode if NODE_ENV not explicitly set to 'development'
const isDevelopment = process.env.NODE_ENV === 'development';

export const errorHandler = (
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    // Log full error for debugging (server-side only)
    console.error('Error:', isDevelopment ? error : error.message);

    if (error.name === 'MongoError' || error.name === 'MongoServerError') {
        const mongoError = error as any;
        if (mongoError.code === 11000) {
            return res.status(409).json({
                error: 'Duplicate entry',
                // SECURITY: Generic message - don't reveal which field is duplicate
                details: 'A record with these details already exists',
            });
        }
    }

    if (error.name === 'ValidationError'){
        return res.status(400).json({
            error: 'Validation failed',
            // SECURITY: Only expose validation details in development
            details: isDevelopment ? error.message : 'Invalid input data',
        });
    }

    return res.status(500).json({
        error: 'Internal server error',
        // SECURITY: Never expose internal error messages in production
        ...(isDevelopment && { message: error.message }),
    });
};