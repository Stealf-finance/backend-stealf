import logger from '../../config/logger';

class HeliusWebhookManager {
    private webhookId = process.env.HELIUS_WEBHOOK_ID!;
    private baseUrl = 'https://api.helius.xyz';
    private apiHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.HELIUS_API_KEY}`,
    };

    async initialize() {
        try {
            const response = await fetch(`${this.baseUrl}/v0/webhooks/${this.webhookId}`, {
                headers: this.apiHeaders,
            });

            if (!response.ok) {
                throw new Error(`Webhook ${this.webhookId} not found on Helius: ${await response.text()}`);
            }

            const webhookData = await response.json();
            logger.info({
                webhookId: this.webhookId,
                type: webhookData.webhookType,
                addresses: webhookData.accountAddresses?.length || 0,
            }, 'Helius webhook verified');

            return webhookData;
        } catch (error) {
            logger.error({ err: error }, 'Failed to verify webhook');
            throw error;
        }
    }

    async addUserWallets(cash_wallet: string, stealf_wallet?: string) {
        try {
            const walletsToAdd: string[] = [];
            if (cash_wallet) walletsToAdd.push(cash_wallet);
            if (stealf_wallet) walletsToAdd.push(stealf_wallet);

            if (walletsToAdd.length === 0) {
                logger.debug('No wallets to add');
                return;
            }

            const getResponse = await fetch(`${this.baseUrl}/v0/webhooks/${this.webhookId}`, {
                headers: this.apiHeaders,
            });
            if (!getResponse.ok) {
                throw new Error(`Failed to fetch webhook: ${await getResponse.text()}`);
            }

            const webhookData = await getResponse.json();
            const existingAddresses: string[] = webhookData.accountAddresses || [];
            const allAddresses = [...new Set([...existingAddresses, ...walletsToAdd])];

            const updatePayload: any = {
                webhookURL: webhookData.webhookURL,
                transactionTypes: webhookData.transactionTypes,
                accountAddresses: allAddresses,
                webhookType: webhookData.webhookType,
            };

            if (webhookData.authHeader) {
                updatePayload.authHeader = webhookData.authHeader;
            }

            const putResponse = await fetch(`${this.baseUrl}/v0/webhooks/${this.webhookId}`, {
                method: 'PUT',
                headers: this.apiHeaders,
                body: JSON.stringify(updatePayload),
            });

            if (!putResponse.ok) {
                const errorText = await putResponse.text();
                throw new Error(`Helius API error (${putResponse.status}): ${errorText}`);
            }

            logger.info({
                walletsAdded: walletsToAdd.length,
                webhookId: this.webhookId,
                totalAddresses: allAddresses.length,
            }, 'Wallets added to webhook');

        } catch (error) {
            logger.error({ err: error }, 'Failed to add user wallets to webhook');
            throw error;
        }
    }
}

let instance: HeliusWebhookManager | null = null;

export function getHeliusWebhookManager(): HeliusWebhookManager {
    if (!instance) {
        instance = new HeliusWebhookManager();
    }
    return instance;
}
