import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { socketAuthMiddleware } from '../../middleware/socketAuth';
import { allowedOrigins } from '../../config/cors';
import { User } from '../../models/User';
import logger from '../../config/logger';

// Solana base58 address: 32-44 alphanumeric chars (no 0, O, I, l)
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// SHA256 hash hex: exactly 64 hex chars
const HEX_HASH_RE = /^[0-9a-f]{64}$/;

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

        this.io.on('connection', async (socket) => {
            const subscribedWallets = new Set<string>();
            const subscribedUsers = new Set<string>();
            const subscribedYield = new Set<string>();

            // Resolve MongoDB user ID for user-scoped subscriptions
            let userMongoId: string | null = null;
            try {
                if (socket.user?.organizationId) {
                    const user = await User.findOne({ turnkey_subOrgId: socket.user.organizationId });
                    if (user) {
                        userMongoId = user._id.toString();
                    }
                }
            } catch (err) {
                logger.error({ err }, 'Failed to load user for socket');
            }

            socket.on('subscribe:wallet', (walletAddress: unknown) => {
                if (typeof walletAddress !== 'string' || !SOLANA_ADDRESS_RE.test(walletAddress)) {
                    return;
                }
                if (!subscribedWallets.has(walletAddress)) {
                    socket.join(walletAddress);
                    subscribedWallets.add(walletAddress);
                    logger.debug({ wallet: walletAddress.slice(0, 8) }, 'Socket subscribed to wallet');
                }
            });

            socket.on('subscribe:user', (userId: unknown) => {
                if (typeof userId !== 'string' || !userMongoId || userId !== userMongoId) {
                    return;
                }
                if (!subscribedUsers.has(userId)) {
                    socket.join(`user:${userId}`);
                    subscribedUsers.add(userId);
                }
            });

            socket.on('subscribe:yield', (userIdHash: unknown) => {
                if (typeof userIdHash !== 'string' || !HEX_HASH_RE.test(userIdHash)) {
                    return;
                }
                if (!subscribedYield.has(userIdHash)) {
                    socket.join(`yield:${userIdHash}`);
                    subscribedYield.add(userIdHash);
                    logger.debug({ hash: userIdHash.slice(0, 12) }, 'Socket subscribed to yield');
                }
            });

            socket.on('disconnect', () => {
                subscribedWallets.clear();
                subscribedUsers.clear();
                subscribedYield.clear();
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

    emitYieldBalanceUpdate(userIdHashHex: string, data: {
        balanceLamports: string;
        balanceJitosol: number;
        balanceSol: number;
        rate: number;
        apy: number;
    }) {
        if (!this.io) {
            logger.warn('Socket.io not initialized');
            return;
        }

        this.io.to(`yield:${userIdHashHex}`).emit('yield:balance-updated', {
            ...data,
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

    hasListeners(walletAddress: string): boolean {
        if (!this.io) return false;
        const room = this.io.sockets.adapter.rooms.get(walletAddress);
        return (room?.size || 0) > 0;
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
