/**
 * Tests pour getTotalActiveDepositLamports()
 *
 * Requirement 3.1 : La somme des dépôts actifs doit être calculée en décryptant
 * les champs AES-256-GCM via les hooks Mongoose, et non via $sum MongoDB
 * qui opère sur des chaînes hexadécimales.
 */

// ========== MOCKS ==========

const mockVaultShareFind = jest.fn();

jest.mock("../../models/VaultShare", () => ({
  VaultShare: {
    find: (...args: any[]) => mockVaultShareFind(...args),
  },
}));

// Pas besoin de Redis pour ce service — on mocke les imports indirectement
jest.mock("../../config/redis", () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue("OK"),
  },
}));

jest.mock("@solana/spl-stake-pool", () => ({}));
jest.mock("@marinade.finance/marinade-ts-sdk", () => ({}));
jest.mock("@solana/spl-token", () => ({
  getAssociatedTokenAddress: jest.fn(),
}));

// ========== IMPORT ==========

import { getTotalActiveDepositLamports } from "../../services/yield/yield-rates.service";

// ========== HELPERS ==========

/** Simule un VaultShare dont depositAmountLamports est déjà décrypté (par hook Mongoose) */
function makeShare(depositAmountLamports: number) {
  return { depositAmountLamports, status: "active" };
}

// ========== TESTS ==========

describe("getTotalActiveDepositLamports", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retourne 0n si aucun VaultShare actif", async () => {
    mockVaultShareFind.mockResolvedValue([]);

    const total = await getTotalActiveDepositLamports();

    expect(total).toBe(0n);
    expect(mockVaultShareFind).toHaveBeenCalledWith({ status: "active" });
  });

  it("retourne la somme correcte de plusieurs VaultShares", async () => {
    mockVaultShareFind.mockResolvedValue([
      makeShare(1_000_000_000), // 1 SOL
      makeShare(500_000_000),   // 0.5 SOL
      makeShare(250_000_000),   // 0.25 SOL
    ]);

    const total = await getTotalActiveDepositLamports();

    // 1 + 0.5 + 0.25 = 1.75 SOL = 1_750_000_000 lamports
    expect(total).toBe(1_750_000_000n);
  });

  it("retourne la valeur exacte d'un seul VaultShare", async () => {
    mockVaultShareFind.mockResolvedValue([makeShare(2_000_000_000)]);

    const total = await getTotalActiveDepositLamports();

    expect(total).toBe(2_000_000_000n);
  });

  it("retourne 0n si un VaultShare a depositAmountLamports=0", async () => {
    mockVaultShareFind.mockResolvedValue([makeShare(0)]);

    const total = await getTotalActiveDepositLamports();

    expect(total).toBe(0n);
  });

  it("retourne 0n si VaultShare.find lève une exception (ne propage pas)", async () => {
    mockVaultShareFind.mockRejectedValue(new Error("MongoDB connection lost"));

    const total = await getTotalActiveDepositLamports();

    expect(total).toBe(0n);
  });

  it("retourne 0n si un document retourne une valeur non-numérique (champ non décrypté)", async () => {
    // Simule un document dont le hook de décryptage Mongoose a échoué
    // et dont depositAmountLamports reste une chaîne hex (cas d'erreur de clé AES)
    mockVaultShareFind.mockResolvedValue([
      { depositAmountLamports: "iv:tag:ciphertext", status: "active" },
    ]);

    const total = await getTotalActiveDepositLamports();

    // NaN converti en BigInt devrait être géré sans exception — retourne 0n
    expect(total).toBe(0n);
  });

  it("ne compte que les VaultShares actifs — filtre bien sur status=active", async () => {
    // Le filtre est passé à VaultShare.find — on vérifie l'argument
    mockVaultShareFind.mockResolvedValue([makeShare(500_000_000)]);

    await getTotalActiveDepositLamports();

    expect(mockVaultShareFind).toHaveBeenCalledWith({ status: "active" });
  });
});
