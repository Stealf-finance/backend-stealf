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