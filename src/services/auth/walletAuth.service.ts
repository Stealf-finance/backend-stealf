import { Turnkey } from "@turnkey/sdk-server";
import { User, IUser } from "../../models/User";
import { getHeliusWebhookManager } from "../helius/webhookManager";
import { privacyBalanceService } from "../privacycash/PrivacyBalanceService";
import bs58 from "bs58";

const turnkeyClient = new Turnkey({
  apiBaseUrl: "https://api.turnkey.com",
  apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
  apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
  defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID!,
});

/**
 * Convert a hex-encoded ed25519 public key to a Solana base58 address.
 */
function hexToBase58(hex: string): string {
  const bytes = Buffer.from(hex, "hex");
  return bs58.encode(bytes);
}

interface CreateWalletUserParams {
  email: string;
  pseudo: string;
  publicKeyHex: string;
}

interface CreateWalletUserResult {
  user: IUser;
  subOrgId: string;
  cashWalletAddress: string;
}

/**
 * Creates a Turnkey sub-organization with the wallet public key as an ED25519 API key,
 * generates a Cash Wallet, and registers the user in the database.
 */
export async function createWalletUser(
  params: CreateWalletUserParams
): Promise<CreateWalletUserResult> {
  const { email, pseudo, publicKeyHex } = params;

  // Check for existing user with same email
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    const err = new Error("Email already registered");
    (err as any).statusCode = 409;
    throw err;
  }

  // Check for existing user with same pseudo
  const existingPseudo = await User.findOne({ pseudo });
  if (existingPseudo) {
    const err = new Error("Pseudo already taken");
    (err as any).statusCode = 409;
    throw err;
  }

  // Create sub-organization with wallet public key as API key authenticator
  const subOrgResponse = await turnkeyClient.apiClient().createSubOrganization({
    organizationId: process.env.TURNKEY_ORGANIZATION_ID!,
    subOrganizationName: `Stealf User - ${email}`,
    rootUsers: [
      {
        userName: email,
        userEmail: email,
        apiKeys: [
          {
            apiKeyName: `Wallet Auth - ${publicKeyHex.substring(0, 16)}`,
            publicKey: publicKeyHex,
            curveType: "API_KEY_CURVE_ED25519",
          },
        ],
        authenticators: [],
        oauthProviders: [],
      },
    ],
    rootQuorumThreshold: 1,
    wallet: {
      walletName: "Cash Wallet",
      accounts: [
        {
          curve: "CURVE_ED25519",
          pathFormat: "PATH_FORMAT_BIP32",
          path: "m/44'/501'/0'/0'",
          addressFormat: "ADDRESS_FORMAT_SOLANA",
        },
      ],
    },
  });

  const subOrgId = subOrgResponse.subOrganizationId;
  const cashWalletAddress =
    subOrgResponse.wallet?.addresses?.[0] ?? "";

  if (!cashWalletAddress) {
    throw new Error("Failed to create Cash Wallet in sub-organization");
  }

  // Convert publicKeyHex to base58 for stealf_wallet address
  const stealfWalletAddress = hexToBase58(publicKeyHex);

  // Create user in database
  const user = await User.create({
    email: email.toLowerCase().trim(),
    pseudo: pseudo.trim(),
    cash_wallet: cashWalletAddress,
    stealf_wallet: stealfWalletAddress,
    turnkey_subOrgId: subOrgId,
    authMethod: "wallet",
    status: "active",
    lastLoginAt: new Date(),
  });

  // Register wallets with Helius webhooks (non-blocking)
  try {
    const webhookManager = getHeliusWebhookManager();
    await webhookManager.addUserWallets(cashWalletAddress, stealfWalletAddress);
  } catch (error) {
    console.error("Failed to add wallets to webhook:", error);
  }

  // Initialize privacy balance (non-blocking)
  try {
    await privacyBalanceService.getOrCreateBalance(user._id.toString());
  } catch (error) {
    console.error("Failed to initialize private balance:", error);
  }

  return {
    user,
    subOrgId,
    cashWalletAddress,
  };
}

/**
 * Find a user by their wallet public key (hex-encoded).
 * Converts hex to base58 and looks up by stealf_wallet.
 */
export async function findUserByWallet(
  publicKeyHex: string
): Promise<IUser | null> {
  const walletAddress = hexToBase58(publicKeyHex);
  const user = await User.findOne({ stealf_wallet: walletAddress });

  if (user) {
    user.lastLoginAt = new Date();
    await user.save();
  }

  return user;
}
