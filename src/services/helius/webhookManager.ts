import { createHelius } from 'helius-sdk';
import { WebhookHelius } from '../../models/WebhookHelius';
import { User } from '../../models/User';

class HeliusWebhookManager {
    private helius;
    private webhookConfigId = 'helius-solana-mainnet';

    constructor() {
        this.helius = createHelius({
            apiKey: process.env.HELIUS_API_KEY!
        });
    }

    async initialize(webhookUrl: string) {

        try {
            const fullWebhookUrl = `${webhookUrl}/api/helius/helius`;
            let config  = await WebhookHelius.findById(this.webhookConfigId);

            if (config){
                console.log('Webhook config found in DB:', config.webhookId);

                if (config.url !== fullWebhookUrl) {
                    console.log(`⚠️  Webhook URL has changed!`);
                    console.log(`   Old: ${config.url}`);
                    console.log(`   New: ${fullWebhookUrl}`);
                    console.log(`   Please update the webhook URL manually in Helius dashboard`);
                    console.log(`   Or delete the webhook and restart the server to create a new one`);
                }

                return config;
            }

            console.log('No webhook config found, creating new webhook...');

            const users = await User.find();
            const wallets: string[] = [];
            users.forEach(user => {
                if (user.cash_wallet) wallets.push(user.cash_wallet);
                if (user.stealf_wallet) wallets.push(user.stealf_wallet);
            });

            const webhook = await this.helius.webhooks.create({
                webhookURL: fullWebhookUrl,
                transactionTypes: ['ANY'],
                accountAddresses: wallets,
                webhookType: 'enhanced',
            });

            console.log('Webhook created:', webhook.webhookID);

            config = await WebhookHelius.create({
                _id: this.webhookConfigId,
                provider: 'helius',
                network: 'solana-mainnet',
                webhookId: webhook.webhookID,
                url: fullWebhookUrl,
                accountCount: wallets.length,
                status: 'active',
            });

            console.log('Webhook config saved to MongoDB');
            return config;

        } catch (error){
            console.error('Failed to initialize webhook:', error);
            throw error;
        }
    }

    async addUserWallets(cash_wallet: string, stealf_wallet: string) {
        try {
            const config = await WebhookHelius.findById(this.webhookConfigId);

            if (!config) {
                throw new Error('Webhook not initialized. Call initialize() first.');
            }

            const walletsToAdd: string[] = [];
            if (cash_wallet) walletsToAdd.push(cash_wallet);
            if (stealf_wallet) walletsToAdd.push(stealf_wallet);

            if (walletsToAdd.length === 0) {
                console.log('No wallets to add');
                return;
            }

            const baseUrl = 'https://mainnet.helius-rpc.com';
            const getUrl = `${baseUrl}/v0/webhooks/${config.webhookId}?api-key=${process.env.HELIUS_API_KEY}`;

            const getResponse = await fetch(getUrl);
            if (!getResponse.ok) {
                throw new Error(`Failed to fetch webhook: ${await getResponse.text()}`);
            }

            const webhookData = await getResponse.json();
            const existingAddresses = webhookData.accountAddresses || [];

            const allAddresses = [...new Set([...existingAddresses, ...walletsToAdd])];

            const putUrl = `${baseUrl}/v0/webhooks/${config.webhookId}?api-key=${process.env.HELIUS_API_KEY}`;

            const updatePayload: any = {
                webhookURL: webhookData.webhookURL,
                transactionTypes: webhookData.transactionTypes,
                accountAddresses: allAddresses,
                webhookType: webhookData.webhookType,
            };

            if (webhookData.authHeader) {
                updatePayload.authHeader = webhookData.authHeader;
            }

            const putResponse = await fetch(putUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(updatePayload),
            });

            if (!putResponse.ok) {
                const errorText = await putResponse.text();
                throw new Error(`Helius API error (${putResponse.status}): ${errorText}`);
            }

            config.accountCount = allAddresses.length;
            await config.save();

            console.log(`Added ${walletsToAdd.length} wallet(s) to webhook ${config.webhookId} (total: ${allAddresses.length})`);

        } catch (error) {
            console.error('Failed to add user wallets to webhook:', error);
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