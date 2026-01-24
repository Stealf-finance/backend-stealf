import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { socketAuthMiddleware } from '../../middleware/socketAuth';

class SocketService {
    private io: SocketIOServer | null = null;

    initialize(httpServer: HTTPServer){
        this.io = new SocketIOServer(httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });

        this.io.use(socketAuthMiddleware);

        this.io.on('connection', (socket) => {
            const subscribedWallets = new Set<string>();

            socket.on('subscribe:wallet', (walletAddress: string) => {
                if (!subscribedWallets.has(walletAddress)) {
                    socket.join(walletAddress);
                    subscribedWallets.add(walletAddress);
                }
            });

            socket.on('disconnect', () => {
                subscribedWallets.clear();
            });
        });

    }

    emitBalanceUpdate(walletAddress: string, balance: number) {
        if (!this.io) {
            console.warn('Socket.io not initialized');
            return;
        }

        this.io.to(walletAddress).emit('balance:updated', {
            address: walletAddress,
            balance,
            timestamp: new Date().toISOString()
        });
    }

    emitNewTransaction(walletAddress: string, transaction: any) {
        if (!this.io){
            console.warn('Socket.io is not initialized');
            return;
        }

        this.io.to(walletAddress).emit('transaction:new', {
            address: walletAddress,
            transaction,
            timestamp: new Date().toISOString()
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