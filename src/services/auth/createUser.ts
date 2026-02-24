import { User } from "../../models/User";
import { getHeliusWebhookManager } from '../helius/webhookManager';
import { privacyBalanceService } from '../privacycash/PrivacyBalanceService';
import logger from '../../config/logger';

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
        logger.info('Wallets successfully added to Helius webhook');
    } catch (error) {
        logger.error({ err: error }, 'Failed to add wallets to webhook');
    }

    try {
        await privacyBalanceService.getOrCreateBalance(user._id.toString());
        logger.info('Private balance initialized for user');
    } catch (error) {
        logger.error({ err: error }, 'Failed to initialize private balance');
    }

    return user;
}
