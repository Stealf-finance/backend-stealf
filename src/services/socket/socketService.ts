import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { socketAuthMiddleware } from '../../middleware/socketAuth';
import { allowedOrigins } from '../../config/cors';
import logger from '../../config/logger';

class SocketService {
    private io: SocketIOServer | null = null;

    initialize(httpServer: HTTPServer){
        this.io = new SocketIOServer(httpServer, {
            cors: {
                origin: allowedOrigins,
                methods: ['GET', 'POST'],
                credentials: true,
            }
        });

        this.io.use(socketAuthMiddleware);

        this.io.on('connection', (socket) => {
            const subscribedWallets = new Set<string>();
            const subscribedUsers = new Set<string>();

            socket.on('subscribe:wallet', (walletAddress: string) => {
                if (!subscribedWallets.has(walletAddress)) {
                    socket.join(walletAddress);
                    subscribedWallets.add(walletAddress);
                }
            });

            socket.on('subscribe:user', (userId: string) => {
                if (!subscribedUsers.has(userId)) {
                    socket.join(`user:${userId}`);
                    subscribedUsers.add(userId);
                }
            });

            socket.on('disconnect', () => {
                subscribedWallets.clear();
                subscribedUsers.clear();
            });
        });

    }

    emitBalanceUpdate(walletAddress: string, walletBalance: { tokens: any[]; totalUSD: number }) {
        if (!this.io) {
            logger.warn('Socket.io not initialized');
            return;
        }

        this.io.to(walletAddress).emit('balance:updated', {
            address: walletAddress,
            tokens: walletBalance.tokens,
            totalUSD: walletBalance.totalUSD,
            timestamp: new Date().toISOString()
        });
    }

    emitNewTransaction(walletAddress: string, transaction: any) {
        if (!this.io){
            logger.warn('Socket.io not initialized');
            return;
        }

        this.io.to(walletAddress).emit('transaction:new', {
            address: walletAddress,
            transaction,
            timestamp: new Date().toISOString()
        });
    }

    emitPrivateTransferUpdate(userId: string, transferData: {
        transferId: string;
        status: string;
        amount: number;
        tokenMint?: string;
        transactions?: {
            vaultDepositTx?: string;
            privacyCashDepositTx?: string;
            privacyCashWithdrawTx?: string;
        };
        errorMessage?: string;
    }) {
        if (!this.io) {
            logger.warn('Socket.io not initialized');
            return;
        }

        this.io.to(`user:${userId}`).emit('private-transfer:status-update', {
            ...transferData,
            timestamp: new Date().toISOString()
        });
    }

    emitPrivateBalanceUpdate(userId: string, balances: {
        sol: number;
        usdc: number;
    }) {
        if (!this.io) {
            logger.warn('Socket.io not initialized');
            return;
        }

        this.io.to(`user:${userId}`).emit('private-balance:updated', {
            balances,
            timestamp: new Date().toISOString()
        });
    }

    close(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.io) {
                resolve();
                return;
            }
            this.io.close(() => resolve());
        });
    }
}

let instance: SocketService | null = null;

export function getSocketService(): SocketService {
    if (!instance) {
        instance = new SocketService();
    }
    return instance;
}
