import { User } from "../../models/User";
import { getHeliusWebhookManager } from '../helius/webhookManager';

export async function createUser(email: string, pseudo: string, cash_wallet: string, stealf_wallet: string, turnkey_subOrgId: string){

    if (!email || !pseudo || !cash_wallet){
        throw new Error('Missing user`s information!');
    }

    const user = await User.create({
        email,
        pseudo,
        cash_wallet,
        stealf_wallet,
        turnkey_subOrgId,
        status: 'active',
        lastLoginAt: new Date(),
    });

    try {
        const webhookManager = getHeliusWebhookManager();

        await webhookManager.addUserWallets(cash_wallet, stealf_wallet);
        console.log('Wallets successfully added to helius webhook!');
    } catch (error) {
        console.error('Failed to add wallets to webhook:', error);
    }

    return user;
}
