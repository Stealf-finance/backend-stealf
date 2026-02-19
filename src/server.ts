import express from 'express';
import mongoose from 'mongoose';
import { createServer } from 'http';
import path from 'path';
import dotenv from 'dotenv';
import userRoutes from './routes/userRoutes'
import walletRoutes from './routes/walletRoutes';
import  webhookHeliusRoutes  from './routes/webhookHeliusRoutes'
import privateTransferRoutes from './routes/privateTransferRoutes';
import swapRoutes from './routes/swapRoutes';
import yieldRoutes from './routes/yieldRoutes';
import { errorHandler } from './middleware/errorHandler';
import { getHeliusWebhookManager } from './services/helius/webhookManager';
import { getSocketService } from './services/socket/socketService';

dotenv.config();

const app = express();

const httpServer = createServer(app);

// SECURITY: Limit request body size to prevent DoS
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Serve Apple App Site Association file
// SECURITY: Use relative path instead of hardcoded absolute path
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.type('application/json');
  res.sendFile(path.join(__dirname, '../public/.well-known/apple-app-site-association'));
});


app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

app.use('/api/users', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/private-transfer', privateTransferRoutes);

app.use('/api/swap', swapRoutes);
app.use('/api/yield', yieldRoutes);
app.use('/api/helius', webhookHeliusRoutes );

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});
app.use(errorHandler);

const PORT = process.env.PORT;

async function start() {
  try {

    await mongoose.connect(process.env.MONGODB_URI!);
    console.log('MongoDB connected');

    const webhookUrl = process.env.WEBHOOK_URL || '';
    const heliusWebhookManager = getHeliusWebhookManager();
    await heliusWebhookManager.initialize(webhookUrl);
    console.log('Helius webhook initialized');

    const socketService = getSocketService();
    socketService.initialize(httpServer);
    console.log('Socket.io initialized');

    httpServer.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    })

  } catch (error) {
    console.error(' Failed to start server:', error);
    process.exit(1);
  }
}

start();