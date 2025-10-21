/**
 * Routes Grid Protocol
 * Gère authentication + account management
 */

import { Router, Request, Response } from 'express';
import { gridAuthService } from '../services/grid/grid-auth.service.js';
import { gridAccountService } from '../services/grid/grid-account.service.js';
import { privyCryptoService } from '../services/privy-crypto.service.js';
import { solanaWalletService } from '../services/wallet/solana-wallet.service.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { authenticateJWT, requireOwnResource } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PublicKey, Keypair } from '@solana/web3.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// AUTHENTICATION ROUTES
// ═══════════════════════════════════════════════════════════════

/**
 * POST /grid/auth
 * Initier l'authentification - Envoie OTP par email (utilisateur existant)
 */
router.post('/auth', asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      error: 'Email required'
    });
  }

  // Generate random session_id
  const sessionId = crypto.randomBytes(32).toString('hex');

  // Call Grid Protocol to initiate auth
  const gridResponse = await gridAuthService.initiateAuthentication({ email });

  // Create session in MongoDB (expires in 10 minutes)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await Session.create({
    sessionId,
    email,
    otpAttempts: 0,
    expiresAt,
    gridResponse: gridResponse.data || gridResponse,
    isLogin: true
  });

  console.log(`✅ Auth session created: ${sessionId} for ${email}`);

  // Return session_id (matching Python backend format)
  res.json({
    session_id: sessionId,
    message: `OTP sent to ${email}`,
    expires_at: expiresAt.toISOString()
  });
}));

/**
 * POST /grid/auth/verify
 * Vérifier l'OTP et générer JWT tokens
 */
router.post('/auth/verify', async (req, res) => {
  try {
    const { session_id, otp_code } = req.body;

    if (!session_id || !otp_code) {
      return res.status(400).json({
        error: 'session_id and otp_code required'
      });
    }

    // Find session in MongoDB
    const session = await Session.findOne({ sessionId: session_id });

    console.log('🔍 Session lookup:', { session_id, found: !!session, email: session?.email });

    if (!session) {
      return res.status(404).json({
        error: 'Invalid or expired session'
      });
    }

    // Check if session expired
    if (new Date() > session.expiresAt) {
      await Session.deleteOne({ sessionId: session_id });
      return res.status(401).json({
        error: 'Session expired'
      });
    }

    // Check OTP attempts
    if (session.otpAttempts >= 3) {
      await Session.deleteOne({ sessionId: session_id });
      return res.status(401).json({
        error: 'Too many OTP attempts'
      });
    }

    // Generate KMS provider config for Grid
    const keypair = privyCryptoService.generateHPKEKeyPair();
    const kms_provider_config = {
      encryption_public_key: keypair.publicKey
    };

    // Verify OTP with Grid Protocol
    const gridResponse = await gridAuthService.verifyAuthentication({
      email: session.email,
      otp_code,
      kms_provider: 'privy',
      kms_provider_config
    });

    console.log('📦 Grid response received:', JSON.stringify(gridResponse, null, 2));

    if (!gridResponse.data) {
      // Increment OTP attempts
      session.otpAttempts += 1;
      await session.save();

      return res.status(401).json({
        error: 'Invalid OTP code',
        attempts_remaining: 3 - session.otpAttempts
      });
    }

    const { address, grid_user_id } = gridResponse.data;

    console.log('💾 Finding/creating user in MongoDB...', { address, grid_user_id });

    // Find or create user in MongoDB
    let user = await User.findOne({ email: session.email });

    if (!user) {
      console.log('👤 Creating new user...');
      user = await User.create({
        email: session.email,
        gridAddress: address,
        gridUserId: grid_user_id,
        kycStatus: 'pending'
      });
      console.log('✅ User created:', user._id);

      // Générer un wallet Solana pour le nouvel utilisateur
      console.log('🔑 Generating Solana wallet for new user...');
      const solanaPublicKey = await solanaWalletService.generateWallet(user._id.toString(), session.email);
      user.solanaWallet = solanaPublicKey;
      await user.save();
      console.log('✅ Solana wallet generated:', solanaPublicKey);
    } else {
      console.log('👤 Updating existing user...');
      // Update user Grid info
      user.gridAddress = address;
      user.gridUserId = grid_user_id;
      user.lastLogin = new Date();

      // Générer un wallet Solana si l'utilisateur n'en a pas encore
      if (!user.solanaWallet) {
        console.log('🔑 No Solana wallet found, generating one...');
        const solanaPublicKey = await solanaWalletService.generateWallet(user._id.toString(), user.email);
        user.solanaWallet = solanaPublicKey;
        console.log('✅ Solana wallet generated:', solanaPublicKey);
      }

      // Note: Le wallet privé Arcium (Privacy 1) sera créé lors de la première transaction privée

      await user.save();
      console.log('✅ User updated');
    }

    // Generate JWT tokens
    console.log('🔑 Generating JWT tokens...');
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

    const access_token = jwt.sign(
      {
        user_id: user._id,
        email: user.email,
        address: address,
        grid_user_id,
        solana_wallet: user.solanaWallet  // Wallet Solana généré
      },
      jwtSecret,
      { expiresIn: '7d' }
    );

    const refresh_token = jwt.sign(
      {
        user_id: user._id,
        email: user.email
      },
      jwtSecret,
      { expiresIn: '30d' }
    );

    console.log('✅ JWT tokens generated');

    // Delete session after successful verification
    await Session.deleteOne({ sessionId: session_id });

    console.log(`✅ User authenticated: ${user.email} (${address})`);

    // Return response matching Python backend format
    res.json({
      tokens: {
        access_token,
        refresh_token,
        token_type: 'bearer',
        expires_in: 604800 // 7 days in seconds
      },
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        first_name: user.firstName,
        last_name: user.lastName,
        address: address,
        grid_user_id,
        solana_wallet: user.solanaWallet, // Wallet Solana généré
        kyc_status: user.kycStatus,
        is_active: user.isActive,
        created_at: user.createdAt,
        last_login: user.lastLogin
      }
    });
  } catch (error: any) {
    console.error('Authentication verification error:', error);

    // Increment OTP attempts on error
    if (req.body.session_id) {
      const session = await Session.findOne({ sessionId: req.body.session_id });
      if (session) {
        session.otpAttempts += 1;
        await session.save();
      }
    }

    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || error.message || 'Internal server error'
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// ACCOUNT MANAGEMENT ROUTES
// ═══════════════════════════════════════════════════════════════

/**
 * POST /grid/accounts
 * Créer un nouveau compte - Envoie OTP par email
 */
router.post('/accounts', asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      error: 'Email required'
    });
  }

  // Grid Protocol requires "type" field for account creation
  const response = await gridAccountService.createAccount({
    email,
    type: 'email'
  });

  res.json(response);
}));

/**
 * POST /grid/accounts/verify
 * Vérifier OTP et compléter la création du compte/wallet
 */
router.post('/accounts/verify', asyncHandler(async (req: Request, res: Response) => {
  const { email, otp_code, kms_provider_config } = req.body;

  if (!email || !otp_code) {
    return res.status(400).json({
      error: 'Email and OTP code required'
    });
  }

  // Generate KMS config if not provided
  let finalKmsConfig = kms_provider_config;
  if (!finalKmsConfig) {
    const keypair = privyCryptoService.generateHPKEKeyPair();
    finalKmsConfig = {
      encryption_public_key: keypair.publicKey
    };
  }

  // Verify OTP with Grid
  const response = await gridAccountService.verifyOTP({
    email,
    otp_code,
    provider: 'privy',
    kms_provider_config: finalKmsConfig
  });

  if (!response.data) {
    return res.status(401).json({
      error: 'Invalid OTP code'
    });
  }

  const { address, grid_user_id } = response.data;

  console.log('💾 Finding/creating user in MongoDB...', { address, grid_user_id });

  // Find or create user in MongoDB
  let user = await User.findOne({ email });

  if (!user) {
    console.log('👤 Creating new user...');
    user = await User.create({
      email,
      gridAddress: address,
      gridUserId: grid_user_id,
      kycStatus: 'pending'
    });
    console.log('✅ User created:', user._id);

    // Générer un wallet Solana pour le nouvel utilisateur
    console.log('🔑 Generating Solana wallet for new user...');
    const solanaPublicKey = await solanaWalletService.generateWallet(user._id.toString(), email);
    user.solanaWallet = solanaPublicKey;
    console.log('✅ Solana wallet generated:', solanaPublicKey);

    // Générer un wallet privé (Privacy 1) pour le nouvel utilisateur
    console.log('🔐 Generating private Solana wallet for new user...');
    const solanaPrivatePublicKey = await solanaWalletService.generatePrivateWallet(user._id.toString(), email);
    user.solanaPrivateWallet = solanaPrivatePublicKey;
    console.log('✅ Private Solana wallet generated:', solanaPrivatePublicKey);

    // Enregistrer dans Arcium MPC
    console.log('🔐 Registering user in Arcium MPC system...');
    try {
      const privateWalletPubkey = new PublicKey(solanaPrivatePublicKey);
      const serverKeypair = await solanaWalletService.getServerKeypair();

      if (serverKeypair) {
        const arciumResult = await privateTransferService.registerUser(privateWalletPubkey, serverKeypair);

        if (arciumResult.success && arciumResult.userId !== undefined) {
          user.arciumUserId = arciumResult.userId;
          console.log('✅ User registered in Arcium with ID:', arciumResult.userId);
        } else {
          console.warn('⚠️  Failed to register in Arcium:', arciumResult.error);
        }
      } else {
        console.warn('⚠️  Server keypair not found, skipping Arcium registration');
      }
    } catch (arciumError: any) {
      console.error('❌ Arcium registration error:', arciumError.message);
      // Continue même si Arcium échoue - on peut enregistrer plus tard
    }

    await user.save();
  } else {
    console.log('👤 Updating existing user...');
    user.gridAddress = address;
    user.gridUserId = grid_user_id;
    user.lastLogin = new Date();
    await user.save();
    console.log('✅ User updated');
  }

  // Generate JWT tokens
  console.log('🔑 Generating JWT tokens...');
  const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

  const access_token = jwt.sign(
    {
      user_id: user._id,
      email: user.email,
      address: address,
      grid_user_id,
      solana_wallet: user.solanaWallet  // Wallet Solana généré
    },
    jwtSecret,
    { expiresIn: '7d' }
  );

  const refresh_token = jwt.sign(
    {
      user_id: user._id,
      email: user.email
    },
    jwtSecret,
    { expiresIn: '30d' }
  );

  console.log('✅ JWT tokens generated');
  console.log(`✅ User registered: ${user.email} (${address})`);

  // Return response matching the auth/verify format
  res.json({
    tokens: {
      access_token,
      refresh_token,
      token_type: 'bearer',
      expires_in: 604800 // 7 days in seconds
    },
    user: {
      id: user._id,
      email: user.email,
      username: user.username,
      first_name: user.firstName,
      last_name: user.lastName,
      address: address,
      grid_user_id,
      solana_wallet: user.solanaWallet, // Wallet Solana généré
      kyc_status: user.kycStatus,
      is_active: user.isActive,
      created_at: user.createdAt,
      last_login: user.lastLogin
    }
  });
}));

/**
 * GET /grid/accounts/:address
 * Obtenir les détails d'un compte
 * 🔒 Protégé par JWT - utilisateur peut seulement voir son propre compte
 */
router.get('/accounts/:address', authenticateJWT, requireOwnResource, asyncHandler(async (req: Request, res: Response) => {
  const { address } = req.params;
  const response = await gridAccountService.getAccountDetails(address);
  res.json(response);
}));

/**
 * PATCH /grid/accounts/:address
 * Mettre à jour un compte
 * 🔒 Protégé par JWT - utilisateur peut seulement modifier son propre compte
 */
router.patch('/accounts/:address', authenticateJWT, requireOwnResource, asyncHandler(async (req: Request, res: Response) => {
  const { address } = req.params;
  const admin = req.query.admin === 'true';

  const response = await gridAccountService.updateAccount(
    address,
    req.body,
    admin
  );

  res.json(response);
}));

/**
 * GET /grid/accounts/:address/balances
 * Obtenir les soldes (SOL + tokens)
 * 🔒 Protégé par JWT - utilisateur peut seulement voir ses propres soldes
 */
router.get('/accounts/:address/balances', authenticateJWT, requireOwnResource, asyncHandler(async (req: Request, res: Response) => {
  const { address } = req.params;
  const response = await gridAccountService.getBalance(address);
  res.json(response);
}));

/**
 * GET /grid/accounts/:address/transactions
 * Obtenir l'historique des transactions
 * 🔒 Protégé par JWT - utilisateur peut seulement voir ses propres transactions
 */
router.get('/accounts/:address/transactions', authenticateJWT, requireOwnResource, asyncHandler(async (req: Request, res: Response) => {
  const { address } = req.params;
  const limit = parseInt(req.query.limit as string) || 10;

  const response = await gridAccountService.getTransactions(address, limit);
  res.json(response);
}));

export default router;
