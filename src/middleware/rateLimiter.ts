import rateLimit from "express-rate-limit";

export const availabilityCheckLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: false,
    skipSuccessfulRequests: false,

    handler: (req, res) => {
        res.status(200).json({
            canProceed: false,
            unavailable: []
        });
    }
});

// SECURITY: Rate limiting per route group (Requirements: 6.1, 6.2, 6.3, 6.4, 6.5)

export const swapLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
        res.status(429).json({ error: 'Too many swap requests. Please retry later.' });
    },
});

export const yieldLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
        res.status(429).json({ error: 'Too many yield requests. Please retry later.' });
    },
});

export const walletLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
        res.status(429).json({ error: 'Too many wallet requests. Please retry later.' });
    },
});
