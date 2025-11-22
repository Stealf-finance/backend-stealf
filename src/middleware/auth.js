/**
 * Simple JWT authentication middleware
 * TODO: Replace with actual JWT verification
 */
export function authenticateJWT(req, res, next) {
    try {
        // For now, just check for Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: 'No authorization token provided',
            });
        }
        // Mock user data - TODO: Replace with real JWT verification
        const token = authHeader.replace('Bearer ', '');
        if (token === 'test' || token === 'dev') {
            req.user = {
                user_id: 'test_user_123',
                email: 'test@example.com',
            };
            return next();
        }
        // For development, accept any token and extract user_id
        req.user = {
            user_id: token.split(':')[0] || 'default_user',
            email: 'user@example.com',
        };
        next();
    }
    catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid authentication token',
        });
    }
}
