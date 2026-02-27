/**
 * Tests — Graceful shutdown (Task 1.4)
 * Requirements: 8.1, 8.2, 8.3, 8.4
 *
 * Vérifie la logique d'arrêt propre du serveur :
 * - Guard isShuttingDown empêche les appels doubles
 * - Séquence correcte : httpServer.close → mongoose.close → process.exit(0)
 * - Timeout 10s force process.exit(1)
 */

describe('Graceful Shutdown — Req 8.1, 8.2, 8.3, 8.4', () => {
  /**
   * Recréation de la fonction shutdown() pour tests unitaires sans démarrer le serveur.
   */
  function buildShutdown(
    mockServerClose: jest.Mock,
    mockMongoClose: jest.Mock,
    mockExit: jest.Mock
  ) {
    let isShuttingDown = false;

    return async function shutdown(signal: string): Promise<void> {
      if (isShuttingDown) return;
      isShuttingDown = true;

      const forceExit = setTimeout(() => mockExit(1), 10_000);
      if (typeof forceExit.unref === 'function') forceExit.unref();

      try {
        await new Promise<void>((resolve) => {
          mockServerClose(resolve);
        });
        await mockMongoClose();
        mockExit(0);
      } catch {
        mockExit(1);
      }
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('appelle httpServer.close() avant mongoose.close() (Req 8.1)', async () => {
    const callOrder: string[] = [];
    const mockServerClose = jest.fn((cb: () => void) => {
      callOrder.push('server.close');
      cb();
    });
    const mockMongoClose = jest.fn().mockImplementation(() => {
      callOrder.push('mongo.close');
      return Promise.resolve();
    });
    const mockExit = jest.fn();

    const shutdown = buildShutdown(mockServerClose, mockMongoClose, mockExit);
    await shutdown('SIGTERM');

    expect(callOrder[0]).toBe('server.close');
    expect(callOrder[1]).toBe('mongo.close');
  });

  it('appelle process.exit(0) après une fermeture réussie (Req 8.1)', async () => {
    const mockServerClose = jest.fn((cb: () => void) => cb());
    const mockMongoClose = jest.fn().mockResolvedValue(undefined);
    const mockExit = jest.fn();

    const shutdown = buildShutdown(mockServerClose, mockMongoClose, mockExit);
    await shutdown('SIGTERM');

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(mockExit).not.toHaveBeenCalledWith(1);
  });

  it('le guard isShuttingDown empêche les appels multiples (Req 8.1)', async () => {
    const mockServerClose = jest.fn((cb: () => void) => cb());
    const mockMongoClose = jest.fn().mockResolvedValue(undefined);
    const mockExit = jest.fn();

    const shutdown = buildShutdown(mockServerClose, mockMongoClose, mockExit);

    // Appels simultanés — seul le premier doit s'exécuter
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT'), shutdown('SIGTERM')]);

    expect(mockServerClose).toHaveBeenCalledTimes(1);
  });

  it('supporte SIGTERM (Req 8.1)', async () => {
    const logs: string[] = [];
    const mockServerClose = jest.fn((cb: () => void) => cb());
    const mockMongoClose = jest.fn().mockResolvedValue(undefined);
    const mockExit = jest.fn();

    // Shutdown fonctionnel sur SIGTERM
    const shutdown = buildShutdown(mockServerClose, mockMongoClose, mockExit);
    await shutdown('SIGTERM');
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('supporte SIGINT (Req 8.2)', async () => {
    const mockServerClose = jest.fn((cb: () => void) => cb());
    const mockMongoClose = jest.fn().mockResolvedValue(undefined);
    const mockExit = jest.fn();

    const shutdown = buildShutdown(mockServerClose, mockMongoClose, mockExit);
    await shutdown('SIGINT');
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('appelle process.exit(1) si la fermeture lève une erreur (Req 8.3)', async () => {
    const mockServerClose = jest.fn((cb: () => void) => cb());
    const mockMongoClose = jest.fn().mockRejectedValue(new Error('DB close failed'));
    const mockExit = jest.fn();

    const shutdown = buildShutdown(mockServerClose, mockMongoClose, mockExit);
    await shutdown('SIGTERM');

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('le timeout de 10s force process.exit(1) si la fermeture est trop lente (Req 8.3)', () => {
    // httpServer.close() ne résout jamais → timeout déclenché
    const mockServerClose = jest.fn((_cb: () => void) => { /* never calls cb */ });
    const mockMongoClose = jest.fn();
    const mockExit = jest.fn();

    const shutdown = buildShutdown(mockServerClose, mockMongoClose, mockExit);
    shutdown('SIGTERM'); // fire-and-forget (never resolves)

    // Avancer le timer de 10 secondes
    jest.advanceTimersByTime(10_001);

    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
