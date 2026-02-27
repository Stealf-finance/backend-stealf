/**
 * Tests — Destinataire email du magic link (Task 2.2)
 * Requirements: 4.1, 4.2, 4.3
 *
 * Vérifie que sendMagicLink() envoie l'email au paramètre `email`
 * et non à une adresse hardcodée.
 */

process.env.VAULT_SHARES_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.RESEND_API_KEY = 're_test_key';
process.env.BACKEND_URL = 'http://localhost:5000';

// Capturer les appels Resend
const mockResendSend = jest.fn().mockResolvedValue({ data: { id: 'email-id-123' }, error: null });
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: (...args: unknown[]) => mockResendSend(...args),
    },
  })),
}));

// Mock MagicLink model
const mockMagicLinkCreate = jest.fn().mockResolvedValue({ _id: 'mock-id' });
jest.mock('../../models/MagicLink', () => ({
  MagicLink: {
    create: (...args: unknown[]) => mockMagicLinkCreate(...args),
  },
}));

import { sendMagicLink } from '../../services/auth/magicLinkService';

describe('sendMagicLink — destinataire email', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('envoie l\'email au paramètre email et non à une adresse hardcodée', async () => {
    const userEmail = 'user@example.com';
    await sendMagicLink(userEmail, 'Alice');

    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const callArgs = mockResendSend.mock.calls[0][0];
    expect(callArgs.to).toBe(userEmail);
  });

  it('n\'envoie jamais à stealf.fi@gmail.com', async () => {
    await sendMagicLink('another@test.com', 'Bob');

    const callArgs = mockResendSend.mock.calls[0][0];
    expect(callArgs.to).not.toBe('stealf.fi@gmail.com');
    expect(callArgs.to).not.toContain('gmail');
  });

  it('envoie avec des adresses email différentes à chaque appel', async () => {
    await sendMagicLink('first@example.com', 'First');
    await sendMagicLink('second@example.com', 'Second');

    expect(mockResendSend).toHaveBeenCalledTimes(2);
    expect(mockResendSend.mock.calls[0][0].to).toBe('first@example.com');
    expect(mockResendSend.mock.calls[1][0].to).toBe('second@example.com');
  });

  it('crée un MagicLink record avec l\'email correct', async () => {
    await sendMagicLink('test@company.io', 'Charlie');

    expect(mockMagicLinkCreate).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@company.io' })
    );
  });

  it('inclut l\'URL de vérification dans le body HTML', async () => {
    await sendMagicLink('verify@test.com', 'Dave');

    const callArgs = mockResendSend.mock.calls[0][0];
    expect(callArgs.html).toContain('verify-magic-link');
    expect(callArgs.html).toContain('Dave');
  });
});
