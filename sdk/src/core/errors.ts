/**
 * Custom error classes for the Stealf Wallet Link SDK
 */

export class WalletLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletLinkError";
  }
}

export class EncryptionError extends WalletLinkError {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
  }
}

export class MPCError extends WalletLinkError {
  constructor(message: string) {
    super(message);
    this.name = "MPCError";
  }
}

export class MPCTimeoutError extends MPCError {
  constructor(timeout: number) {
    super(`MPC computation timed out after ${timeout}ms`);
    this.name = "MPCTimeoutError";
  }
}

export class WalletNotConnectedError extends WalletLinkError {
  constructor() {
    super("Wallet is not connected");
    this.name = "WalletNotConnectedError";
  }
}

export class InsufficientBalanceError extends WalletLinkError {
  constructor(required: number, actual: number) {
    super(`Insufficient balance: required ${required} SOL, have ${actual} SOL`);
    this.name = "InsufficientBalanceError";
  }
}

export class WalletsAlreadyLinkedError extends WalletLinkError {
  constructor() {
    super("Wallets are already linked for this user");
    this.name = "WalletsAlreadyLinkedError";
  }
}

export class WalletsNotLinkedError extends WalletLinkError {
  constructor() {
    super("No linked wallets found for this user");
    this.name = "WalletsNotLinkedError";
  }
}

export class InvalidPublicKeyError extends WalletLinkError {
  constructor(key: string) {
    super(`Invalid public key: ${key}`);
    this.name = "InvalidPublicKeyError";
  }
}

export class NetworkError extends WalletLinkError {
  constructor(message: string) {
    super(`Network error: ${message}`);
    this.name = "NetworkError";
  }
}