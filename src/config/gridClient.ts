import { GridClient, GridEnvironment } from '@sqds/grid';

let clientInstance: GridClient | null = null;

export class SDKGridClient {
    private static validateEnv() {
        if (!process.env.GRID_API_KEY) {
            throw new Error('Missing required environment variable: GRID_API_KEY must be set.');
        }
        if (!process.env.GRID_ENV) {
            throw new Error('Missing required environment variable: GRID_ENV must be set (sandbox or production).');
        }
    }

    private static getEnvironment(): GridEnvironment {
        const gridEnv = process.env.GRID_ENV;
        if (gridEnv !== 'sandbox' && gridEnv !== 'production') {
            throw new Error('GRID_ENV must be either "sandbox" or "production".');
        }
        return gridEnv as GridEnvironment;
    }

    static getInstance(): GridClient {
        if (!clientInstance) {
            this.validateEnv();
            const environment = this.getEnvironment();

            clientInstance = new GridClient({
                apiKey: process.env.GRID_API_KEY!,
                environment,
                baseUrl: 'https://grid.squads.xyz'
            });
        }
        return clientInstance;
    }

    static cleanup(): void {
        clientInstance = null;
    }
}
