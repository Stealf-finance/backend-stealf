import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";

const isDev = process.env.NODE_ENV !== 'production';
const skipInDev = () => isDev;

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

export const pollingLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    skip: skipInDev,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            error: 'Too many requests, please try again later'
        });
    }
});

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

export const magicLinkLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    skip: skipInDev,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            error: 'Too many magic link requests, please try again later'
        });
    }
});
