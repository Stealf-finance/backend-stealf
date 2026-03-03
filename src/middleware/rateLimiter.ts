import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";

const isDev = process.env.NODE_ENV !== 'production';
const skipInDev = () => isDev;

// Existing limiter for /check-availability endpoint
export const availabilityCheckLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    skip: skipInDev,
    standardHeaders: false,
    skipSuccessfulRequests: false,

    handler: (_req: Request, res: Response) => {
        res.status(200).json({
            canProceed: false,
            unavailable: []
        });
    }
});

// Global rate limiter: 100 requests per 15 minutes per IP
export const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    skip: skipInDev,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            error: 'Too many requests, please try again later'
        });
    }
});

// Auth rate limiter: 10 requests per 15 minutes per IP
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skip: skipInDev,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            error: 'Too many requests, please try again later'
        });
    }
});

// Swap rate limiter: 20 requests per minute per IP
export const swapLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    skip: skipInDev,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            error: 'Too many requests, please try again later'
        });
    }
});

// Wallet rate limiter: 30 requests per minute per IP
export const walletLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    skip: skipInDev,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            error: 'Too many requests, please try again later'
        });
    }
});

// Yield rate limiter: 20 requests per minute per IP
export const yieldLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    skip: skipInDev,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            error: 'Too many requests, please try again later'
        });
    }
});

// Withdraw rate limiter: 5 requests per 15 minutes per IP
export const withdrawLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    skip: skipInDev,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            error: 'Too many requests, please try again later'
        });
    }
});
