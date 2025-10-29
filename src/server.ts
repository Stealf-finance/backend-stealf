import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import accountRoutes from './routes/account.routes';
import transactionRoutes from './routes/transaction.routes';

// Load environment variables
dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS Configuration
const corsOptions = {
    origin: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',')
        : '*',
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.GRID_ENV || 'not configured'
    });
});

// Debug endpoint - REMOVE IN PRODUCTION
app.get('/debug/env', (req: Request, res: Response) => {
    res.status(200).json({
        GRID_ENV: process.env.GRID_ENV || 'not set',
        GRID_ENDPOINT: process.env.GRID_ENDPOINT || 'not set',
        GRID_API_KEY: process.env.GRID_API_KEY ? '***configured***' : 'not set',
        PORT: process.env.PORT || 'not set',
        NODE_ENV: process.env.NODE_ENV || 'not set'
    });
});

// Routes
app.use('/', authRoutes);
app.use('/', accountRoutes);
app.use('/', transactionRoutes);

// 404 Handler
app.use((req: Request, res: Response) => {
    res.status(404).json({
        error: 'Not Found',
        path: req.path
    });
});

// Error Handler
app.use((err: any, req: Request, res: Response, next: any) => {
    console.error('Unhandled error:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║   Stealf Backend Server                   ║
║   Powered by GRID SDK                     ║
╚═══════════════════════════════════════════╝

🚀 Server running on port ${PORT}
🌍 Environment: ${process.env.GRID_ENV || 'not configured'}
📡 Health check: http://localhost:${PORT}/health

Available endpoints:
  POST   /grid/auth
  POST   /grid/auth/verify
  POST   /grid/accounts
  POST   /grid/accounts/verify
  POST   /grid/smart-accounts
  POST   /grid/balance
  GET    /grid/transfers
  POST   /grid/payment-intent
  POST   /grid/confirm
    `);
});

export default app;
