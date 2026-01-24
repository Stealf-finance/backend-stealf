import express, { Request, Response } from 'express';
import { rainService } from '../services/rain.service.js';
import { RainUser } from '../models/rain-user.model.js';
import { RainCard } from '../models/rain-card.model.js';
import { RainTransaction } from '../models/rain-transaction.model.js';
import { User } from '../models/User.js';
// @ts-ignore - multer types may not be available
import multer from 'multer';

const router = express.Router();

// Configure multer for file uploads (in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max (Rain limit)
  },
});

// ==========================================
// RAIN CARDS API ROUTES
// KYC, Cards, and Transactions for PUBLIC wallet only
// ==========================================

/**
 * GET /rain/status
 * Get Rain service status
 */
router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({
      success: true,
      data: {
        ready: rainService.isReady(),
        environment: rainService.getEnvironment(),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ==========================================
// KYC / APPLICATIONS
// ==========================================

/**
 * POST /rain/kyc/apply
 * Create a KYC application for a user
 * Links Rain account to the user's PUBLIC wallet only
 */
router.post('/kyc/apply', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      // Stealf user identification
      userId, // MongoDB ObjectId of Stealf user

      // Personal info
      firstName,
      lastName,
      email,
      birthDate, // YYYY-MM-DD
      nationalId,
      countryOfIssue, // ISO alpha-2

      // Contact
      phoneCountryCode,
      phoneNumber,

      // Address
      address, // { line1, line2?, city, region, postalCode, countryCode }

      // Financial info
      occupation, // SOC code
      annualSalary,
      accountPurpose,
      expectedMonthlyVolume,

      // Terms
      isTermsOfServiceAccepted,
    } = req.body;

    // Validation
    if (!userId) {
      res.status(400).json({
        success: false,
        error: 'userId is required',
      });
      return;
    }

    if (!firstName || !lastName || !email) {
      res.status(400).json({
        success: false,
        error: 'firstName, lastName, and email are required',
      });
      return;
    }

    if (!isTermsOfServiceAccepted) {
      res.status(400).json({
        success: false,
        error: 'Terms of service must be accepted',
      });
      return;
    }

    // Check if Rain service is ready
    if (!rainService.isReady()) {
      res.status(503).json({
        success: false,
        error: 'Rain service not available',
      });
      return;
    }

    // Get Stealf user to retrieve PUBLIC wallet address
    const stealfUser = await User.findById(userId);
    if (!stealfUser) {
      res.status(404).json({
        success: false,
        error: 'User not found',
      });
      return;
    }

    // Ensure user has a public wallet
    if (!stealfUser.solanaWallet) {
      res.status(400).json({
        success: false,
        error: 'User does not have a public wallet configured',
      });
      return;
    }

    // Check if user already has a Rain application
    const existingRainUser = await RainUser.findOne({ userId });
    if (existingRainUser) {
      res.status(409).json({
        success: false,
        error: 'User already has a Rain KYC application',
        data: {
          rainUserId: existingRainUser.rainUserId,
          applicationStatus: existingRainUser.applicationStatus,
          applicationCompletionUrl: existingRainUser.applicationCompletionUrl,
        },
      });
      return;
    }

    // Get user's IP address
    const ipAddress = req.headers['x-forwarded-for'] as string ||
                      req.socket.remoteAddress ||
                      '0.0.0.0';

    // Create Rain application linked to PUBLIC wallet
    const rainResponse = await rainService.createConsumerApplication({
      firstName,
      lastName,
      email,
      birthDate,
      nationalId,
      countryOfIssue,
      ipAddress: typeof ipAddress === 'string' ? ipAddress.split(',')[0].trim() : ipAddress,
      occupation,
      annualSalary,
      accountPurpose,
      expectedMonthlyVolume,
      isTermsOfServiceAccepted: true,
      address,
      phoneCountryCode,
      phoneNumber,
      // Link to PUBLIC wallet ONLY
      solanaAddress: stealfUser.solanaWallet,
      sourceKey: 'stealf',
    });

    // Store Rain user data in our database
    const rainUser = await RainUser.create({
      userId: stealfUser._id,
      email,
      rainUserId: rainResponse.id,
      solanaAddress: stealfUser.solanaWallet,
      applicationStatus: rainResponse.applicationStatus,
      applicationCompletionUrl: rainResponse.applicationCompletionLink?.url,
      applicationReason: rainResponse.applicationReason,
      firstName,
      lastName,
      birthDate,
      phoneCountryCode,
      phoneNumber,
      address,
    });

    console.log(`[Rain] KYC application created for user ${userId}`);
    console.log(`[Rain] Linked to PUBLIC wallet: ${stealfUser.solanaWallet}`);

    res.json({
      success: true,
      data: {
        rainUserId: rainResponse.id,
        applicationStatus: rainResponse.applicationStatus,
        applicationCompletionUrl: rainResponse.applicationCompletionLink?.url,
        applicationReason: rainResponse.applicationReason,
        linkedWallet: stealfUser.solanaWallet,
        walletType: 'public', // Explicitly indicate this is the public wallet
      },
    });
  } catch (error: any) {
    console.error('[Rain] KYC apply error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /rain/kyc/status/:userId
 * Get KYC application status for a user
 */
router.get('/kyc/status/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    if (!userId) {
      res.status(400).json({
        success: false,
        error: 'userId is required',
      });
      return;
    }

    // Get Rain user from our database
    const rainUser = await RainUser.findOne({ userId });
    if (!rainUser) {
      res.status(404).json({
        success: false,
        error: 'No Rain KYC application found for this user',
      });
      return;
    }

    // Optionally refresh status from Rain API
    if (rainService.isReady() && rainUser.rainUserId) {
      try {
        const rainStatus = await rainService.getApplicationStatus(rainUser.rainUserId);

        // Update local record if status changed
        if (rainStatus.applicationStatus !== rainUser.applicationStatus) {
          rainUser.applicationStatus = rainStatus.applicationStatus;
          rainUser.applicationCompletionUrl = rainStatus.applicationCompletionLink?.url;
          rainUser.applicationReason = rainStatus.applicationReason;

          // Set approval timestamp if newly approved
          if (rainStatus.applicationStatus === 'approved' && !rainUser.kycApprovedAt) {
            rainUser.kycApprovedAt = new Date();
          }

          await rainUser.save();
        }
      } catch (apiError) {
        console.warn('[Rain] Could not refresh status from API:', apiError);
        // Continue with cached data
      }
    }

    res.json({
      success: true,
      data: {
        rainUserId: rainUser.rainUserId,
        applicationStatus: rainUser.applicationStatus,
        applicationCompletionUrl: rainUser.applicationCompletionUrl,
        applicationReason: rainUser.applicationReason,
        linkedWallet: rainUser.solanaAddress,
        walletType: 'public',
        kycApprovedAt: rainUser.kycApprovedAt,
        documentsUploaded: rainUser.documentsUploaded,
      },
    });
  } catch (error: any) {
    console.error('[Rain] KYC status error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /rain/kyc/document/:userId
 * Upload a document for KYC verification
 */
router.post(
  '/kyc/document/:userId',
  upload.single('document'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      const { type, side, countryCode } = req.body;
      const file = req.file;

      // Validation
      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'userId is required',
        });
        return;
      }

      if (!file) {
        res.status(400).json({
          success: false,
          error: 'Document file is required',
        });
        return;
      }

      if (!type) {
        res.status(400).json({
          success: false,
          error: 'Document type is required (idCard, passport, drivers, selfie, etc.)',
        });
        return;
      }

      if (!countryCode) {
        res.status(400).json({
          success: false,
          error: 'countryCode is required (ISO alpha-2, e.g., "US")',
        });
        return;
      }

      // Check Rain service
      if (!rainService.isReady()) {
        res.status(503).json({
          success: false,
          error: 'Rain service not available',
        });
        return;
      }

      // Get Rain user
      const rainUser = await RainUser.findOne({ userId });
      if (!rainUser) {
        res.status(404).json({
          success: false,
          error: 'No Rain KYC application found for this user. Apply first.',
        });
        return;
      }

      // Upload document to Rain
      await rainService.uploadDocument({
        userId: rainUser.rainUserId,
        document: file.buffer,
        filename: file.originalname,
        type,
        side,
        countryCode,
      });

      // Track uploaded document
      rainUser.documentsUploaded.push({
        type,
        side,
        uploadedAt: new Date(),
      });
      await rainUser.save();

      console.log(`[Rain] Document uploaded for user ${userId}: ${type} ${side || ''}`);

      res.json({
        success: true,
        data: {
          message: 'Document uploaded successfully',
          documentType: type,
          side: side || null,
        },
      });
    } catch (error: any) {
      console.error('[Rain] Document upload error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// ==========================================
// WEBHOOKS
// ==========================================

/**
 * POST /rain/webhook
 * Webhook endpoint for Rain status updates
 */
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify webhook signature
    const signature = req.headers['x-webhook-signature'] as string;
    const payload = JSON.stringify(req.body);

    if (signature && !rainService.verifyWebhookSignature(payload, signature)) {
      console.error('[Rain Webhook] Invalid signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const { resource, action, body } = req.body;

    console.log(`[Rain Webhook] ${resource}.${action}:`, JSON.stringify(body));

    // Handle different webhook events
    switch (`${resource}.${action}`) {
      case 'user.updated':
        // KYC status changed
        await handleUserUpdatedWebhook(body);
        break;

      case 'transaction.requested':
        // Transaction authorization request (Self-Managed)
        // CRITICAL: Must respond 200 (approve) or 401 (decline)
        const authResult = await handleTransactionRequestedWebhook(body);
        if (authResult.approved) {
          res.status(200).json({ approved: true });
        } else {
          res.status(401).json({ approved: false, reason: authResult.reason });
        }
        return;

      case 'transaction.created':
        // Transaction authorized (logging only)
        await handleTransactionCreatedWebhook(body);
        break;

      case 'transaction.updated':
        // Transaction modified (incremental auth, reversal)
        await handleTransactionUpdatedWebhook(body);
        break;

      case 'transaction.completed':
        // Transaction settled - release hold + debit user
        await handleTransactionCompletedWebhook(body);
        break;

      case 'card.updated':
        // Card status changed
        await handleCardUpdatedWebhook(body);
        break;

      case 'card.notification':
        // Card lifecycle events (shipped, activated)
        console.log('[Rain Webhook] Card notification:', body);
        break;

      case 'dispute.created':
        // New dispute
        console.log('[Rain Webhook] Dispute created:', body);
        break;

      case 'dispute.updated':
        // Dispute status changed
        console.log('[Rain Webhook] Dispute updated:', body);
        break;

      case 'transaction.3ds_challenge':
        // 3DS OTP delivery request
        // TODO: Implement 3DS OTP delivery via Twilio/SendGrid
        console.log('[Rain Webhook] 3DS challenge:', body);
        break;

      default:
        console.log(`[Rain Webhook] Unhandled event: ${resource}.${action}`);
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('[Rain Webhook] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Handle user.updated webhook (KYC status change)
 */
async function handleUserUpdatedWebhook(body: any): Promise<void> {
  const { id, applicationStatus, applicationReason } = body;

  if (!id) {
    console.error('[Rain Webhook] user.updated missing id');
    return;
  }

  // Find and update our Rain user record
  const rainUser = await RainUser.findOne({ rainUserId: id });
  if (!rainUser) {
    console.warn(`[Rain Webhook] No local record for Rain user: ${id}`);
    return;
  }

  const previousStatus = rainUser.applicationStatus;
  rainUser.applicationStatus = applicationStatus;
  rainUser.applicationReason = applicationReason;

  // Set approval timestamp if newly approved
  if (applicationStatus === 'approved' && previousStatus !== 'approved') {
    rainUser.kycApprovedAt = new Date();
    console.log(`[Rain Webhook] User ${rainUser.userId} KYC APPROVED`);
  }

  await rainUser.save();

  console.log(`[Rain Webhook] User ${rainUser.userId} status: ${previousStatus} -> ${applicationStatus}`);
}

/**
 * Handle transaction.requested webhook (Self-Managed Authorization)
 * CRITICAL: Must respond quickly - approve or decline
 */
async function handleTransactionRequestedWebhook(body: any): Promise<{ approved: boolean; reason?: string }> {
  const { id: transactionId, spend } = body;

  if (!spend) {
    console.error('[Rain Webhook] transaction.requested missing spend data');
    return { approved: false, reason: 'INVALID_REQUEST' };
  }

  const { userId: rainUserId, cardId, amount, currency, merchantName, merchantCategory, merchantCategoryCode, authorizedAmount, cardType, authorizationMethod } = spend;

  console.log(`[Rain Webhook] Authorization request: ${transactionId}`);
  console.log(`[Rain Webhook] Amount: ${amount} ${currency}, Merchant: ${merchantName}`);

  // Find our local user by Rain userId
  const rainUser = await RainUser.findOne({ rainUserId });
  if (!rainUser) {
    console.error(`[Rain Webhook] User not found for Rain userId: ${rainUserId}`);
    return { approved: false, reason: 'USER_NOT_FOUND' };
  }

  // Get user's available balance
  const user = await User.findById(rainUser.userId);
  if (!user) {
    console.error(`[Rain Webhook] Stealf user not found: ${rainUser.userId}`);
    return { approved: false, reason: 'USER_NOT_FOUND' };
  }

  // Calculate available balance (total - holds - locked)
  const activeHolds = await RainTransaction.find({
    userId: rainUser.userId,
    isHoldActive: true,
    status: 'pending',
  });
  const totalHolds = activeHolds.reduce((sum, tx) => sum + tx.holdAmount, 0);

  const now = new Date();
  const lockedFunds = await RainTransaction.find({
    userId: rainUser.userId,
    status: 'completed',
    fundsAvailableAt: { $gt: now },
  });
  const totalLocked = lockedFunds.reduce((sum, tx) => sum + tx.amount, 0);

  const totalBalance = (user as any).rainCardBalance || 0;
  const availableBalance = totalBalance - totalHolds - totalLocked;

  console.log(`[Rain Webhook] User balance: ${totalBalance}, Holds: ${totalHolds}, Locked: ${totalLocked}, Available: ${availableBalance}`);

  // Check if refund (negative amount) - handle differently
  const isRefund = amount < 0;

  // For refunds, we don't need balance check
  if (!isRefund && availableBalance < Math.abs(amount)) {
    console.log(`[Rain Webhook] Insufficient balance: ${availableBalance} < ${amount}`);
    return { approved: false, reason: 'INSUFFICIENT_BALANCE' };
  }

  // Block first-transaction refunds (fraud indicator)
  if (isRefund) {
    const userTransactionCount = await RainTransaction.countDocuments({ userId: rainUser.userId });
    if (userTransactionCount === 0) {
      console.warn(`[Rain Webhook] Blocked first-transaction refund for user ${rainUser.userId}`);
      return { approved: false, reason: 'FIRST_TRANSACTION_REFUND_BLOCKED' };
    }
  }

  // Create transaction record with hold
  await RainTransaction.create({
    userId: rainUser.userId,
    rainTransactionId: transactionId,
    rainUserId,
    rainCardId: cardId,
    type: 'spend',
    status: 'pending',
    amount: Math.abs(amount),
    authorizedAmount: authorizedAmount || Math.abs(amount),
    currency: currency || 'USD',
    holdAmount: Math.abs(amount),
    isHoldActive: true,
    merchantName,
    merchantCategory,
    merchantCategoryCode,
    cardType,
    authorizationMethod,
    authorizedAt: new Date(),
    isRefund,
  });

  console.log(`[Rain Webhook] Authorization APPROVED: ${transactionId}`);
  return { approved: true };
}

/**
 * Handle transaction.created webhook (Authorization confirmed)
 */
async function handleTransactionCreatedWebhook(body: any): Promise<void> {
  const { id: transactionId, spend } = body;

  if (!spend) {
    console.error('[Rain Webhook] transaction.created missing spend data');
    return;
  }

  console.log(`[Rain Webhook] Transaction created: ${transactionId} - Status: ${spend.status}`);

  // Update local record if exists
  const transaction = await RainTransaction.findOne({ rainTransactionId: transactionId });
  if (transaction) {
    transaction.status = spend.status;
    if (spend.authorizedAt) {
      transaction.authorizedAt = new Date(spend.authorizedAt);
    }
    await transaction.save();
  }
}

/**
 * Handle transaction.updated webhook (Incremental auth, reversal)
 */
async function handleTransactionUpdatedWebhook(body: any): Promise<void> {
  const { id: transactionId, spend } = body;

  if (!spend) {
    console.error('[Rain Webhook] transaction.updated missing spend data');
    return;
  }

  const transaction = await RainTransaction.findOne({ rainTransactionId: transactionId });
  if (!transaction) {
    console.warn(`[Rain Webhook] Transaction not found for update: ${transactionId}`);
    return;
  }

  const previousAmount = transaction.amount;
  const newAmount = Math.abs(spend.amount);
  const previousStatus = transaction.status;

  console.log(`[Rain Webhook] Transaction updated: ${transactionId}`);
  console.log(`[Rain Webhook] Amount: ${previousAmount} -> ${newAmount}, Status: ${spend.status}`);

  // Handle reversal
  if (spend.status === 'reversed') {
    transaction.status = 'reversed';
    // For partial reversal, update hold amount but keep hold active until settlement
    transaction.holdAmount = newAmount;
    console.log(`[Rain Webhook] Transaction reversed. New hold amount: ${newAmount}`);
  }
  // Handle incremental authorization
  else if (newAmount > previousAmount) {
    const incrementAmount = newAmount - previousAmount;
    transaction.amount = newAmount;
    transaction.holdAmount = newAmount;
    console.log(`[Rain Webhook] Incremental auth: +${incrementAmount}`);
  }

  transaction.amount = newAmount;
  await transaction.save();

  console.log(`[Rain Webhook] Transaction ${transactionId} status: ${previousStatus} -> ${transaction.status}`);
}

/**
 * Handle transaction.completed webhook (Settlement)
 * CRITICAL: Release hold and debit user
 */
async function handleTransactionCompletedWebhook(body: any): Promise<void> {
  const { id: transactionId, spend } = body;

  if (!spend) {
    console.error('[Rain Webhook] transaction.completed missing spend data');
    return;
  }

  const { amount: finalAmount, postedAt } = spend;

  console.log(`[Rain Webhook] Transaction completed: ${transactionId}`);
  console.log(`[Rain Webhook] Final amount: ${finalAmount}`);

  // Find transaction
  let transaction = await RainTransaction.findOne({ rainTransactionId: transactionId });

  // Handle Force Capture (settlement without prior authorization)
  if (!transaction) {
    console.log(`[Rain Webhook] Force capture detected: ${transactionId}`);

    // Find user by Rain userId from spend data
    const rainUser = await RainUser.findOne({ rainUserId: spend.userId });
    if (!rainUser) {
      console.error(`[Rain Webhook] User not found for force capture: ${spend.userId}`);
      return;
    }

    // Create transaction record for force capture
    transaction = await RainTransaction.create({
      userId: rainUser.userId,
      rainTransactionId: transactionId,
      rainUserId: spend.userId,
      rainCardId: spend.cardId,
      type: 'spend',
      status: 'completed',
      amount: Math.abs(finalAmount),
      authorizedAmount: Math.abs(finalAmount),
      currency: spend.currency || 'USD',
      holdAmount: 0,
      isHoldActive: false,
      merchantName: spend.merchantName,
      merchantCategory: spend.merchantCategory,
      merchantCategoryCode: spend.merchantCategoryCode,
      cardType: spend.cardType,
      authorizationMethod: spend.authorizationMethod,
      authorizedAt: new Date(spend.authorizedAt || Date.now()),
      postedAt: postedAt ? new Date(postedAt) : new Date(),
      settledAt: new Date(),
      fundsAvailableAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h hold rule
      isRefund: finalAmount < 0,
    });
  }

  const isRefund = finalAmount < 0;
  const absoluteAmount = Math.abs(finalAmount);

  // Release hold
  transaction.isHoldActive = false;
  transaction.holdReleasedAt = new Date();
  transaction.holdAmount = 0;

  // Update status and settlement info
  transaction.status = 'completed';
  transaction.amount = absoluteAmount;
  transaction.settledAt = new Date();
  transaction.postedAt = postedAt ? new Date(postedAt) : new Date();

  // Apply 24h hold rule for fraud prevention
  transaction.fundsAvailableAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await transaction.save();

  // Update user balance
  const user = await User.findById(transaction.userId);
  if (user) {
    if (isRefund) {
      // Credit user for refund
      (user as any).rainCardBalance = ((user as any).rainCardBalance || 0) + absoluteAmount;
      console.log(`[Rain Webhook] Refund credited: +${absoluteAmount}`);
    } else {
      // Debit user for spend
      (user as any).rainCardBalance = ((user as any).rainCardBalance || 0) - absoluteAmount;
      console.log(`[Rain Webhook] User debited: -${absoluteAmount}`);
    }
    await user.save();
  }

  console.log(`[Rain Webhook] Settlement complete for ${transactionId}. Funds available at: ${transaction.fundsAvailableAt}`);
}

/**
 * Handle card.updated webhook
 */
async function handleCardUpdatedWebhook(body: any): Promise<void> {
  const { id: cardId, status, reason } = body;

  if (!cardId) {
    console.error('[Rain Webhook] card.updated missing cardId');
    return;
  }

  console.log(`[Rain Webhook] Card updated: ${cardId} - Status: ${status}, Reason: ${reason || 'N/A'}`);

  // Update local card record
  const card = await RainCard.findOne({ rainCardId: cardId });
  if (!card) {
    console.warn(`[Rain Webhook] Card not found: ${cardId}`);
    return;
  }

  const previousStatus = card.status;
  card.status = status;

  if (status === 'active' && !card.activatedAt) {
    card.activatedAt = new Date();
  } else if (status === 'locked' && !card.lockedAt) {
    card.lockedAt = new Date();
  } else if (status === 'canceled' && !card.canceledAt) {
    card.canceledAt = new Date();
  }

  await card.save();

  console.log(`[Rain Webhook] Card ${cardId} status: ${previousStatus} -> ${status}`);
}

// ==========================================
// LEDGER / FUNDING
// ==========================================

/**
 * POST /rain/fund
 * Fund the Rain card balance from user's Solana wallet (USDC)
 * This converts USDC to USD balance on the card
 */
router.post('/fund', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, amountUsdCents, source } = req.body;

    // Validation
    if (!userId) {
      res.status(400).json({ success: false, error: 'userId is required' });
      return;
    }

    if (!amountUsdCents || amountUsdCents <= 0) {
      res.status(400).json({ success: false, error: 'amountUsdCents must be positive' });
      return;
    }

    // Minimum $1, maximum $10,000 per transaction
    if (amountUsdCents < 100) {
      res.status(400).json({ success: false, error: 'Minimum funding amount is $1.00' });
      return;
    }
    if (amountUsdCents > 1000000) {
      res.status(400).json({ success: false, error: 'Maximum funding amount is $10,000.00 per transaction' });
      return;
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Check KYC status
    const rainUser = await RainUser.findOne({ userId });
    if (!rainUser || rainUser.applicationStatus !== 'approved') {
      res.status(400).json({
        success: false,
        error: 'KYC must be approved before funding card',
      });
      return;
    }

    // TODO: In production, this should:
    // 1. Verify user has sufficient USDC in their Solana wallet
    // 2. Transfer USDC from user's wallet to Stealf's treasury wallet
    // 3. Convert USDC to USD at current rate (or use stablecoin 1:1)
    // 4. Credit the user's rainCardBalance
    //
    // For now, we'll just credit the balance directly (sandbox mode)

    const previousBalance = user.rainCardBalance || 0;
    user.rainCardBalance = previousBalance + amountUsdCents;
    user.rainCardBalanceUpdatedAt = new Date();
    await user.save();

    console.log(`[Rain] Funded user ${userId}: +$${(amountUsdCents / 100).toFixed(2)} (${source || 'manual'})`);
    console.log(`[Rain] New balance: $${(user.rainCardBalance / 100).toFixed(2)}`);

    res.json({
      success: true,
      data: {
        previousBalance: previousBalance,
        amountAdded: amountUsdCents,
        newBalance: user.rainCardBalance,
        currency: 'USD',
        fundedAt: user.rainCardBalanceUpdatedAt,
      },
    });
  } catch (error: any) {
    console.error('[Rain] Fund error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /rain/withdraw
 * Withdraw from Rain card balance to user's Solana wallet (as USDC)
 */
router.post('/withdraw', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, amountUsdCents, destinationAddress } = req.body;

    // Validation
    if (!userId) {
      res.status(400).json({ success: false, error: 'userId is required' });
      return;
    }

    if (!amountUsdCents || amountUsdCents <= 0) {
      res.status(400).json({ success: false, error: 'amountUsdCents must be positive' });
      return;
    }

    // Minimum $10 withdrawal
    if (amountUsdCents < 1000) {
      res.status(400).json({ success: false, error: 'Minimum withdrawal amount is $10.00' });
      return;
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Calculate available balance (total - holds - locked)
    const activeHolds = await RainTransaction.find({
      userId,
      isHoldActive: true,
      status: 'pending',
    });
    const totalHolds = activeHolds.reduce((sum, tx) => sum + tx.holdAmount, 0);

    const now = new Date();
    const lockedFunds = await RainTransaction.find({
      userId,
      status: 'completed',
      fundsAvailableAt: { $gt: now },
    });
    const totalLocked = lockedFunds.reduce((sum, tx) => sum + tx.amount, 0);

    const totalBalance = user.rainCardBalance || 0;
    const availableBalance = totalBalance - totalHolds - totalLocked;

    if (availableBalance < amountUsdCents) {
      res.status(400).json({
        success: false,
        error: `Insufficient available balance. Available: $${(availableBalance / 100).toFixed(2)}`,
        data: {
          totalBalance,
          holds: totalHolds,
          lockedFunds: totalLocked,
          availableBalance,
          requested: amountUsdCents,
        },
      });
      return;
    }

    // Deduct from balance
    const previousBalance = user.rainCardBalance;
    user.rainCardBalance = previousBalance - amountUsdCents;
    user.rainCardBalanceUpdatedAt = new Date();
    await user.save();

    // TODO: In production, this should:
    // 1. Convert USD to USDC
    // 2. Transfer USDC from Stealf's treasury to user's wallet (or destinationAddress)
    // 3. Record the withdrawal transaction

    const destination = destinationAddress || user.solanaWallet;

    console.log(`[Rain] Withdrawal for user ${userId}: -$${(amountUsdCents / 100).toFixed(2)} to ${destination}`);
    console.log(`[Rain] New balance: $${(user.rainCardBalance / 100).toFixed(2)}`);

    res.json({
      success: true,
      data: {
        previousBalance,
        amountWithdrawn: amountUsdCents,
        newBalance: user.rainCardBalance,
        currency: 'USD',
        destinationAddress: destination,
        withdrawnAt: user.rainCardBalanceUpdatedAt,
        // TODO: Add Solana transaction signature when implemented
        // solanaSignature: 'xxx...'
      },
    });
  } catch (error: any) {
    console.error('[Rain] Withdraw error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /rain/ledger/:userId
 * Get complete ledger view for a user (balance, holds, transactions summary)
 */
router.get('/ledger/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    if (!userId) {
      res.status(400).json({ success: false, error: 'userId is required' });
      return;
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Get active holds
    const activeHolds = await RainTransaction.find({
      userId,
      isHoldActive: true,
      status: 'pending',
    }).sort({ authorizedAt: -1 });

    const totalHolds = activeHolds.reduce((sum, tx) => sum + tx.holdAmount, 0);

    // Get locked funds (24h rule after settlement)
    const now = new Date();
    const lockedFunds = await RainTransaction.find({
      userId,
      status: 'completed',
      fundsAvailableAt: { $gt: now },
    }).sort({ settledAt: -1 });

    const totalLocked = lockedFunds.reduce((sum, tx) => sum + tx.amount, 0);

    // Get recent transactions
    const recentTransactions = await RainTransaction.find({ userId })
      .sort({ authorizedAt: -1 })
      .limit(10);

    // Get transaction stats
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const monthlySpend = await RainTransaction.aggregate([
      {
        $match: {
          userId: user._id,
          status: 'completed',
          isRefund: false,
          settledAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    // Calculate balances
    const totalBalance = user.rainCardBalance || 0;
    const availableBalance = totalBalance - totalHolds - totalLocked;

    // Get cards summary
    const cards = await RainCard.find({ userId }).select('type status last4 limit');
    const activeCards = cards.filter(c => c.status === 'active').length;

    res.json({
      success: true,
      data: {
        // Balance summary
        balance: {
          total: totalBalance,
          holds: totalHolds,
          locked: totalLocked,
          available: availableBalance,
          currency: 'USD',
          lastUpdated: user.rainCardBalanceUpdatedAt,
        },

        // Active holds detail
        holds: {
          count: activeHolds.length,
          total: totalHolds,
          items: activeHolds.map(h => ({
            id: h._id,
            amount: h.holdAmount,
            merchant: h.merchantName,
            authorizedAt: h.authorizedAt,
          })),
        },

        // Locked funds detail (24h rule)
        lockedFunds: {
          count: lockedFunds.length,
          total: totalLocked,
          items: lockedFunds.map(l => ({
            id: l._id,
            amount: l.amount,
            merchant: l.merchantName,
            availableAt: l.fundsAvailableAt,
          })),
        },

        // Monthly stats
        monthlyStats: {
          spend: monthlySpend[0]?.total || 0,
          transactionCount: monthlySpend[0]?.count || 0,
          periodStart: thirtyDaysAgo,
          periodEnd: now,
        },

        // Cards summary
        cards: {
          total: cards.length,
          active: activeCards,
          items: cards,
        },

        // Recent activity
        recentTransactions: recentTransactions.map(t => ({
          id: t._id,
          amount: t.amount,
          status: t.status,
          merchant: t.merchantName,
          merchantIcon: t.enrichedMerchantIcon,
          authorizedAt: t.authorizedAt,
          isRefund: t.isRefund,
        })),
      },
    });
  } catch (error: any) {
    console.error('[Rain] Get ledger error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /rain/dashboard/:userId
 * Get complete dashboard data for the frontend (optimized single call)
 */
router.get('/dashboard/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    if (!userId) {
      res.status(400).json({ success: false, error: 'userId is required' });
      return;
    }

    // Get user with Rain data
    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Get Rain user (KYC info)
    const rainUser = await RainUser.findOne({ userId });

    // Get primary card (most recently used active card)
    const primaryCard = await RainCard.findOne({
      userId,
      status: 'active',
    }).sort({ updatedAt: -1 });

    // Get all cards
    const allCards = await RainCard.find({ userId }).sort({ createdAt: -1 });

    // Calculate available balance
    const activeHolds = await RainTransaction.find({
      userId,
      isHoldActive: true,
      status: 'pending',
    });
    const totalHolds = activeHolds.reduce((sum, tx) => sum + tx.holdAmount, 0);

    const now = new Date();
    const lockedFunds = await RainTransaction.find({
      userId,
      status: 'completed',
      fundsAvailableAt: { $gt: now },
    });
    const totalLocked = lockedFunds.reduce((sum, tx) => sum + tx.amount, 0);

    const totalBalance = user.rainCardBalance || 0;
    const availableBalance = totalBalance - totalHolds - totalLocked;

    // Get recent transactions (last 5 for quick view)
    const recentTransactions = await RainTransaction.find({ userId })
      .sort({ authorizedAt: -1 })
      .limit(5);

    // Pending transactions count
    const pendingCount = await RainTransaction.countDocuments({
      userId,
      status: 'pending',
    });

    res.json({
      success: true,
      data: {
        // User info
        user: {
          id: user._id,
          email: user.email,
          solanaWallet: user.solanaWallet,
        },

        // KYC Status
        kyc: rainUser ? {
          status: rainUser.applicationStatus,
          completionUrl: rainUser.applicationCompletionUrl,
          approvedAt: rainUser.kycApprovedAt,
        } : {
          status: 'notStarted',
        },

        // Balance
        balance: {
          total: totalBalance,
          available: availableBalance,
          holds: totalHolds,
          locked: totalLocked,
          currency: 'USD',
        },

        // Primary card for quick access
        primaryCard: primaryCard ? {
          id: primaryCard._id,
          rainCardId: primaryCard.rainCardId,
          type: primaryCard.type,
          status: primaryCard.status,
          last4: primaryCard.last4,
          expirationMonth: primaryCard.expirationMonth,
          expirationYear: primaryCard.expirationYear,
          limit: primaryCard.limit,
        } : null,

        // Cards summary
        cards: {
          total: allCards.length,
          active: allCards.filter(c => c.status === 'active').length,
          virtual: allCards.filter(c => c.type === 'virtual').length,
          physical: allCards.filter(c => c.type === 'physical').length,
        },

        // Recent activity
        recentTransactions: recentTransactions.map(t => ({
          id: t._id,
          amount: t.amount,
          status: t.status,
          merchant: t.enrichedMerchantName || t.merchantName,
          merchantIcon: t.enrichedMerchantIcon,
          category: t.enrichedMerchantCategory || t.merchantCategory,
          authorizedAt: t.authorizedAt,
          isRefund: t.isRefund,
        })),

        // Notifications / Alerts
        alerts: {
          pendingTransactions: pendingCount,
          kycActionRequired: rainUser?.applicationStatus === 'needsVerification' ||
                            rainUser?.applicationStatus === 'needsInformation',
          noActiveCard: allCards.filter(c => c.status === 'active').length === 0 &&
                       rainUser?.applicationStatus === 'approved',
        },
      },
    });
  } catch (error: any) {
    console.error('[Rain] Get dashboard error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// CARDS
// ==========================================

/**
 * POST /rain/cards/create
 * Create a new card for a user (virtual or physical)
 */
router.post('/cards/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      userId, // Stealf user ID
      type, // 'virtual' or 'physical'
      displayName,
      limit, // { amount: number (cents), frequency: string }
      shipping, // Required for physical cards
      billing,
    } = req.body;

    // Validation
    if (!userId) {
      res.status(400).json({ success: false, error: 'userId is required' });
      return;
    }

    if (!type || !['virtual', 'physical'].includes(type)) {
      res.status(400).json({ success: false, error: 'type must be "virtual" or "physical"' });
      return;
    }

    if (!rainService.isReady()) {
      res.status(503).json({ success: false, error: 'Rain service not available' });
      return;
    }

    // Get Rain user
    const rainUser = await RainUser.findOne({ userId });
    if (!rainUser) {
      res.status(404).json({
        success: false,
        error: 'No Rain KYC application found. Complete KYC first.',
      });
      return;
    }

    // Check KYC is approved
    if (rainUser.applicationStatus !== 'approved') {
      res.status(400).json({
        success: false,
        error: `KYC not approved. Current status: ${rainUser.applicationStatus}`,
      });
      return;
    }

    // Physical card validation
    if (type === 'physical' && !shipping) {
      res.status(400).json({
        success: false,
        error: 'Shipping address is required for physical cards',
      });
      return;
    }

    // Create card via Rain API
    const rainCard = await rainService.createCard({
      userId: rainUser.rainUserId,
      type,
      status: type === 'physical' ? 'notActivated' : 'active', // Virtual cards active by default
      limit: limit || { amount: 100000, frequency: 'per30DayPeriod' as const }, // Default $1000/month
      configuration: displayName ? { displayName } : undefined,
      shipping,
      billing,
    });

    // Store card locally
    const localCard = await RainCard.create({
      userId: rainUser.userId,
      rainCardId: rainCard.id,
      rainUserId: rainUser.rainUserId,
      type: rainCard.type,
      status: rainCard.status,
      last4: rainCard.last4,
      expirationMonth: rainCard.expirationMonth,
      expirationYear: rainCard.expirationYear,
      limit: rainCard.limit,
      displayName,
      shipping,
      billing,
      tokenWallets: rainCard.tokenWallets,
    });

    console.log(`[Rain] Card created for user ${userId}: ${rainCard.id} (${type})`);

    res.json({
      success: true,
      data: {
        cardId: localCard._id,
        rainCardId: rainCard.id,
        type: rainCard.type,
        status: rainCard.status,
        last4: rainCard.last4,
        expirationMonth: rainCard.expirationMonth,
        expirationYear: rainCard.expirationYear,
        limit: rainCard.limit,
      },
    });
  } catch (error: any) {
    console.error('[Rain] Create card error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /rain/cards/:userId
 * Get all cards for a user
 */
router.get('/cards/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { status } = req.query;

    if (!userId) {
      res.status(400).json({ success: false, error: 'userId is required' });
      return;
    }

    // Get local cards (faster than API)
    const query: any = { userId };
    if (status) {
      query.status = status;
    }

    const cards = await RainCard.find(query).sort({ createdAt: -1 });

    // Optionally refresh from Rain API if no local cards
    if (cards.length === 0 && rainService.isReady()) {
      const rainUser = await RainUser.findOne({ userId });
      if (rainUser) {
        try {
          const rainCards = await rainService.getCards({ userId: rainUser.rainUserId });
          // Sync cards to local DB
          for (const rc of rainCards) {
            await RainCard.findOneAndUpdate(
              { rainCardId: rc.id },
              {
                userId: rainUser.userId,
                rainCardId: rc.id,
                rainUserId: rainUser.rainUserId,
                type: rc.type,
                status: rc.status,
                last4: rc.last4,
                expirationMonth: rc.expirationMonth,
                expirationYear: rc.expirationYear,
                limit: rc.limit,
                tokenWallets: rc.tokenWallets,
              },
              { upsert: true, new: true }
            );
          }
          // Re-fetch local cards
          const updatedCards = await RainCard.find(query).sort({ createdAt: -1 });
          res.json({ success: true, data: updatedCards });
          return;
        } catch (apiError) {
          console.warn('[Rain] Could not refresh cards from API:', apiError);
        }
      }
    }

    res.json({ success: true, data: cards });
  } catch (error: any) {
    console.error('[Rain] Get cards error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /rain/cards/details/:cardId
 * Get detailed card info
 */
router.get('/cards/details/:cardId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cardId } = req.params;

    if (!cardId) {
      res.status(400).json({ success: false, error: 'cardId is required' });
      return;
    }

    // Get local card
    const card = await RainCard.findById(cardId);
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }

    // Optionally refresh from Rain API
    if (rainService.isReady()) {
      try {
        const rainCard = await rainService.getCard(card.rainCardId);
        // Update local record if status changed
        if (rainCard.status !== card.status) {
          card.status = rainCard.status;
          if (rainCard.status === 'active' && !card.activatedAt) {
            card.activatedAt = new Date();
          } else if (rainCard.status === 'locked' && !card.lockedAt) {
            card.lockedAt = new Date();
          } else if (rainCard.status === 'canceled' && !card.canceledAt) {
            card.canceledAt = new Date();
          }
          await card.save();
        }
      } catch (apiError) {
        console.warn('[Rain] Could not refresh card from API:', apiError);
      }
    }

    res.json({ success: true, data: card });
  } catch (error: any) {
    console.error('[Rain] Get card details error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /rain/cards/:cardId/activate
 * Activate a card
 */
router.post('/cards/:cardId/activate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cardId } = req.params;

    const card = await RainCard.findById(cardId);
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }

    if (card.status === 'active') {
      res.status(400).json({ success: false, error: 'Card is already active' });
      return;
    }

    if (card.status === 'canceled') {
      res.status(400).json({ success: false, error: 'Cannot activate a canceled card' });
      return;
    }

    if (!rainService.isReady()) {
      res.status(503).json({ success: false, error: 'Rain service not available' });
      return;
    }

    // Activate via Rain API
    const rainCard = await rainService.activateCard(card.rainCardId);

    // Update local record
    card.status = rainCard.status;
    card.activatedAt = new Date();
    await card.save();

    console.log(`[Rain] Card activated: ${cardId}`);

    res.json({ success: true, data: { status: card.status, activatedAt: card.activatedAt } });
  } catch (error: any) {
    console.error('[Rain] Activate card error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /rain/cards/:cardId/lock
 * Lock (freeze) a card temporarily
 */
router.post('/cards/:cardId/lock', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cardId } = req.params;

    const card = await RainCard.findById(cardId);
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }

    if (card.status === 'locked') {
      res.status(400).json({ success: false, error: 'Card is already locked' });
      return;
    }

    if (card.status === 'canceled') {
      res.status(400).json({ success: false, error: 'Cannot lock a canceled card' });
      return;
    }

    if (!rainService.isReady()) {
      res.status(503).json({ success: false, error: 'Rain service not available' });
      return;
    }

    // Lock via Rain API
    const rainCard = await rainService.lockCard(card.rainCardId);

    // Update local record
    card.status = rainCard.status;
    card.lockedAt = new Date();
    await card.save();

    console.log(`[Rain] Card locked: ${cardId}`);

    res.json({ success: true, data: { status: card.status, lockedAt: card.lockedAt } });
  } catch (error: any) {
    console.error('[Rain] Lock card error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /rain/cards/:cardId/unlock
 * Unlock a previously locked card
 */
router.post('/cards/:cardId/unlock', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cardId } = req.params;

    const card = await RainCard.findById(cardId);
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }

    if (card.status !== 'locked') {
      res.status(400).json({ success: false, error: 'Card is not locked' });
      return;
    }

    if (!rainService.isReady()) {
      res.status(503).json({ success: false, error: 'Rain service not available' });
      return;
    }

    // Unlock via Rain API
    const rainCard = await rainService.unlockCard(card.rainCardId);

    // Update local record
    card.status = rainCard.status;
    await card.save();

    console.log(`[Rain] Card unlocked: ${cardId}`);

    res.json({ success: true, data: { status: card.status } });
  } catch (error: any) {
    console.error('[Rain] Unlock card error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /rain/cards/:cardId/cancel
 * Cancel a card (permanent, irreversible)
 */
router.post('/cards/:cardId/cancel', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cardId } = req.params;

    const card = await RainCard.findById(cardId);
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }

    if (card.status === 'canceled') {
      res.status(400).json({ success: false, error: 'Card is already canceled' });
      return;
    }

    if (!rainService.isReady()) {
      res.status(503).json({ success: false, error: 'Rain service not available' });
      return;
    }

    // Cancel via Rain API
    const rainCard = await rainService.cancelCard(card.rainCardId);

    // Update local record
    card.status = rainCard.status;
    card.canceledAt = new Date();
    await card.save();

    console.log(`[Rain] Card canceled: ${cardId}`);

    res.json({ success: true, data: { status: card.status, canceledAt: card.canceledAt } });
  } catch (error: any) {
    console.error('[Rain] Cancel card error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /rain/cards/:cardId/limit
 * Update card spending limit
 */
router.patch('/cards/:cardId/limit', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cardId } = req.params;
    const { amount, frequency } = req.body;

    if (!amount || !frequency) {
      res.status(400).json({
        success: false,
        error: 'amount (in cents) and frequency are required',
      });
      return;
    }

    const validFrequencies = [
      'per24HourPeriod',
      'per7DayPeriod',
      'per30DayPeriod',
      'perYearPeriod',
      'allTime',
      'perAuthorization',
    ];
    if (!validFrequencies.includes(frequency)) {
      res.status(400).json({
        success: false,
        error: `frequency must be one of: ${validFrequencies.join(', ')}`,
      });
      return;
    }

    const card = await RainCard.findById(cardId);
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }

    if (!rainService.isReady()) {
      res.status(503).json({ success: false, error: 'Rain service not available' });
      return;
    }

    // Update via Rain API
    const rainCard = await rainService.updateCard(card.rainCardId, {
      limit: { amount, frequency },
    });

    // Update local record
    card.limit = rainCard.limit;
    await card.save();

    console.log(`[Rain] Card limit updated: ${cardId} - ${amount} ${frequency}`);

    res.json({ success: true, data: { limit: card.limit } });
  } catch (error: any) {
    console.error('[Rain] Update card limit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /rain/cards/:cardId/secrets
 * Get encrypted card secrets (PAN, CVC)
 * Requires sessionId in request body for encryption
 */
router.post('/cards/:cardId/secrets', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cardId } = req.params;
    const { sessionId } = req.body;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'sessionId is required' });
      return;
    }

    const card = await RainCard.findById(cardId);
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }

    if (!rainService.isReady()) {
      res.status(503).json({ success: false, error: 'Rain service not available' });
      return;
    }

    // Encrypt sessionId using Rain's public key
    const encryptedSessionId = rainService.encryptSessionId(sessionId);

    // Get encrypted card secrets
    const secrets = await rainService.getCardSecrets(card.rainCardId, encryptedSessionId);

    res.json({ success: true, data: secrets });
  } catch (error: any) {
    console.error('[Rain] Get card secrets error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /rain/cards/:cardId/pin
 * Get encrypted card PIN
 */
router.post('/cards/:cardId/pin', async (req: Request, res: Response): Promise<void> => {
  try {
    const { cardId } = req.params;
    const { sessionId } = req.body;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'sessionId is required' });
      return;
    }

    const card = await RainCard.findById(cardId);
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }

    if (card.type !== 'physical') {
      res.status(400).json({ success: false, error: 'PIN is only available for physical cards' });
      return;
    }

    if (!rainService.isReady()) {
      res.status(503).json({ success: false, error: 'Rain service not available' });
      return;
    }

    // Encrypt sessionId
    const encryptedSessionId = rainService.encryptSessionId(sessionId);

    // Get encrypted PIN
    const pin = await rainService.getCardPin(card.rainCardId, encryptedSessionId);

    res.json({ success: true, data: pin });
  } catch (error: any) {
    console.error('[Rain] Get card PIN error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// TRANSACTIONS
// ==========================================

/**
 * GET /rain/transactions/:userId
 * Get transactions for a user
 */
router.get('/transactions/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { limit, cursor, status, cardId } = req.query;

    if (!userId) {
      res.status(400).json({ success: false, error: 'userId is required' });
      return;
    }

    // Get local transactions first (faster)
    const query: any = { userId };
    if (status) query.status = status;
    if (cardId) query.rainCardId = cardId;

    const localTransactions = await RainTransaction.find(query)
      .sort({ authorizedAt: -1 })
      .limit(Number(limit) || 50);

    // If requesting fresh data, sync from Rain API
    if (rainService.isReady() && req.query.refresh === 'true') {
      const rainUser = await RainUser.findOne({ userId });
      if (rainUser) {
        try {
          const rainTransactions = await rainService.getUserTransactions(rainUser.rainUserId, {
            limit: Number(limit) || 50,
            cursor: cursor as string,
          });

          // Sync to local DB
          for (const rt of rainTransactions) {
            if (rt.spend) {
              await RainTransaction.findOneAndUpdate(
                { rainTransactionId: rt.id },
                {
                  userId,
                  rainTransactionId: rt.id,
                  rainUserId: rt.spend.userId,
                  rainCardId: rt.spend.cardId,
                  type: rt.type,
                  status: rt.spend.status,
                  amount: rt.spend.amount,
                  authorizedAmount: rt.spend.authorizedAmount,
                  localAmount: rt.spend.localAmount,
                  currency: rt.spend.currency,
                  localCurrency: rt.spend.localCurrency,
                  merchantName: rt.spend.merchantName,
                  merchantCategory: rt.spend.merchantCategory,
                  merchantCategoryCode: rt.spend.merchantCategoryCode,
                  merchantId: rt.spend.merchantId,
                  enrichedMerchantName: rt.spend.enrichedMerchantName,
                  enrichedMerchantCategory: rt.spend.enrichedMerchantCategory,
                  enrichedMerchantIcon: rt.spend.enrichedMerchantIcon,
                  cardType: rt.spend.cardType,
                  authorizationMethod: rt.spend.authorizationMethod,
                  declinedReason: rt.spend.declinedReason,
                  authorizedAt: new Date(rt.spend.authorizedAt),
                  postedAt: rt.spend.postedAt ? new Date(rt.spend.postedAt) : undefined,
                  isRefund: rt.spend.amount < 0,
                  holdAmount: rt.spend.status === 'pending' ? rt.spend.amount : 0,
                  isHoldActive: rt.spend.status === 'pending',
                },
                { upsert: true, new: true }
              );
            }
          }

          // Re-fetch updated local transactions
          const updatedTransactions = await RainTransaction.find(query)
            .sort({ authorizedAt: -1 })
            .limit(Number(limit) || 50);

          res.json({ success: true, data: updatedTransactions, source: 'synced' });
          return;
        } catch (apiError) {
          console.warn('[Rain] Could not refresh transactions from API:', apiError);
        }
      }
    }

    res.json({ success: true, data: localTransactions, source: 'cache' });
  } catch (error: any) {
    console.error('[Rain] Get transactions error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /rain/transactions/details/:transactionId
 * Get transaction details
 */
router.get('/transactions/details/:transactionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      res.status(400).json({ success: false, error: 'transactionId is required' });
      return;
    }

    // Get local transaction
    const transaction = await RainTransaction.findById(transactionId);
    if (!transaction) {
      res.status(404).json({ success: false, error: 'Transaction not found' });
      return;
    }

    res.json({ success: true, data: transaction });
  } catch (error: any) {
    console.error('[Rain] Get transaction details error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /rain/balance/:userId
 * Get user's available balance (total - holds - locked funds)
 * This is for Self-Managed ledger
 */
router.get('/balance/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    if (!userId) {
      res.status(400).json({ success: false, error: 'userId is required' });
      return;
    }

    // Get user's total balance (from your main User model)
    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Get active holds
    const activeHolds = await RainTransaction.find({
      userId,
      isHoldActive: true,
      status: 'pending',
    });
    const totalHolds = activeHolds.reduce((sum, tx) => sum + tx.holdAmount, 0);

    // Get locked funds (within 24h of settlement)
    const now = new Date();
    const lockedFunds = await RainTransaction.find({
      userId,
      status: 'completed',
      fundsAvailableAt: { $gt: now },
    });
    const totalLocked = lockedFunds.reduce((sum, tx) => sum + tx.amount, 0);

    // Calculate available balance
    // Note: You need to have a 'balance' field on your User model for Rain card balance
    const totalBalance = (user as any).rainCardBalance || 0;
    const availableBalance = totalBalance - totalHolds - totalLocked;

    res.json({
      success: true,
      data: {
        totalBalance,
        holds: totalHolds,
        lockedFunds: totalLocked,
        availableBalance,
        currency: 'USD',
        holdCount: activeHolds.length,
        lockedCount: lockedFunds.length,
      },
    });
  } catch (error: any) {
    console.error('[Rain] Get balance error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
