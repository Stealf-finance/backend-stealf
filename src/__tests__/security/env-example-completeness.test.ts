/**
 * Tests de conformité — .env.example
 * Requirements: 4.2, 4.5
 *
 * Vérifie que le template .env.example documente toutes les variables
 * nécessaires pour un déploiement en production, incluant CORS et NODE_ENV.
 */

import * as fs from 'fs';
import * as path from 'path';

const ENV_EXAMPLE_PATH = path.resolve(__dirname, '../../../.env.example');

function getEnvExampleKeys(): string[] {
  const content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
  return content
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => line.split('=')[0].trim())
    .filter(Boolean);
}

describe('.env.example — conformité configuration production', () => {
  it('le fichier .env.example existe', () => {
    expect(fs.existsSync(ENV_EXAMPLE_PATH)).toBe(true);
  });

  it('contient NODE_ENV (requis pour activer les protections production)', () => {
    const keys = getEnvExampleKeys();
    expect(keys).toContain('NODE_ENV');
  });

  it('contient ALLOWED_ORIGINS (requis pour le CORS en production)', () => {
    const keys = getEnvExampleKeys();
    expect(keys).toContain('ALLOWED_ORIGINS');
  });

  it('contient JUPITER_API_KEY (requis pour le swap en production)', () => {
    const keys = getEnvExampleKeys();
    expect(keys).toContain('JUPITER_API_KEY');
  });

  it('ne contient pas de valeurs de secrets réels (pas de clés privées en clair)', () => {
    const content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
    // Les champs de clés privées doivent être vides ou avoir une valeur placeholder
    const privateKeyLines = content
      .split('\n')
      .filter((line) => line.includes('PRIVATE_KEY') || line.includes('SECRET'));
    privateKeyLines.forEach((line) => {
      const value = line.split('=')[1]?.trim() ?? '';
      // Valeur vide ou commentaire ou placeholder < 20 chars → OK
      // Une vraie clé privée Solana fait 87-88 chars base58
      expect(value.length).toBeLessThan(50);
    });
  });
});
