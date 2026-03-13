# Audit Sécurité — Stealf Backend

**Date** : 2026-03-13
**Branche auditée** : `developpement`
**Statut** : En cours de durcissement

---

## Résumé

| Catégorie | Statut |
|-----------|--------|
| Authentification | ✅ Solide |
| Validation des entrées | ✅ Implémenté |
| Webhooks | ✅ Sécurisé |
| Chiffrement (MPC) | ✅ Solide |
| Rate limiting | ⚠️ Dev only — désactivé en dev |
| CORS | ⚠️ Permissif en dev |
| Headers sécurité | ✅ Helmet activé |
| Logging | ✅ Structuré + redaction |
| Gestion d'erreurs | ✅ Messages masqués en prod |
| Secrets | ⚠️ Points d'attention |

---

## Mesures en place

### Authentification
- **JWT Turnkey** : Vérification via `@turnkey/sdk-server`, pas de gestion de clés privées côté backend
- **Magic links** : Tokens hashés (bcrypt), TTL MongoDB, usage unique
- **Pré-auth sessions** : Redis avec expiration, constant-time response (500ms) pour éviter les timing attacks sur `/check-availability`
- **Middleware `verifyAuth`** : Obligatoire sur toutes les routes protégées, vérifie l'existence de l'utilisateur en base

### Validation des entrées
- **Zod** sur toutes les routes :
  - `authUserSchema` : email, pseudo, wallets (regex Solana)
  - `yieldWithdrawSchema` : userId, amount (entier positif), wallet (regex Solana)
  - `swapOrderSchema` / `swapExecuteSchema` : mints, montants, signatures
  - `heliusWebhookPayloadSchema` : structure webhook validée
- **Body size limit** : 10kb par défaut, 5mb pour les webhooks Helius

### Webhooks Helius
- **Auth header** : `crypto.timingSafeEqual()` pour la vérification du secret (constant-time)
- **Dedup** : Set in-memory (max 5000 signatures) pour éviter les traitements doubles
- **Fire-and-forget** : Réponse 200 immédiate, traitement en background (évite les retries Helius)
- **Validation payload** : Schéma Zod avant traitement

### Chiffrement MPC (Arcium)
- **X25519 key exchange** : Clés éphémères jetées après usage
- **RescueCipher** : Chiffrement symétrique post-key-exchange
- **Soldes jamais en clair on-chain** : Tout passe par le MXE
- **Balance query** : Le backend déchiffre via éphémère propre — le solde en clair ne transite que sur HTTPS authentifié

### Sécurité réseau
- **Helmet** : Headers sécurité (CSP, X-Frame-Options, HSTS, etc.)
- **Rate limiting par route** :
  - Global : 100 req / 15min
  - Auth : 10 req / 15min
  - Swap : 20 req / min
  - Wallet : 30 req / min
  - Yield : 20 req / min
- **CORS** : Restreint à `FRONTEND_URL` en production

### Logging & Monitoring
- **Pino** : Logging structuré JSON
- **Redaction** : Headers `authorization` masqués dans les logs
- **Sentry** : Capture d'erreurs avec scrubbing des données sensibles
- **Error handler** : Messages d'erreur génériques en production (pas de stack traces)

---

## Vulnérabilités corrigées (PR security-audit)

| # | Sévérité | Issue | Correction |
|---|----------|-------|------------|
| 1-2 | CRITICAL | IDOR accès wallet | `verifyWalletOwnership()` |
| 3 | CRITICAL | IDOR withdrawal | userId depuis session, pas body |
| 4 | CRITICAL | Pas de validation `/api/users/auth` | `authUserSchema` Zod |
| 6 | HIGH | Webhook payload non validé | `heliusWebhookPayloadSchema` |
| 7 | MEDIUM | Stack traces en production | Mode prod par défaut |
| 8 | MEDIUM | Chemin hardcodé dans server.ts | `path.join(__dirname, ...)` |
| 11 | MEDIUM | Timing attack sur disponibilité | Délai constant 500ms |
| 12 | LOW | Limite non bornée (wallet history) | Borné 1-100 |
| 15 | LOW | Email hardcodé magic link | Email de l'utilisateur |
| 17 | LOW | Pas de limite body size | 10kb limit |

---

## Points d'attention actuels

### ⚠️ VAULT_AUTHORITY_PRIVATE_KEY

La clé privée du payer MPC est dans `.env`. C'est le compte qui signe les transactions
`process_deposit`, `process_withdrawal`, `get_balance`. En production :

- **Risque** : Si le serveur est compromis, l'attaquant peut signer des transactions MPC
- **Mitigation** : Le programme Arcium vérifie les ciphertexts — l'attaquant ne peut pas
  forger de faux soldes sans la clé MXE (détenue par le réseau MPC)
- **Recommandation** : Utiliser un HSM ou KMS (AWS KMS, GCP Cloud HSM) pour le signing

### ⚠️ Rate limiting désactivé en développement

```typescript
skip: (_req) => process.env.NODE_ENV === 'development'
```

S'assurer que `NODE_ENV=production` est bien défini en prod.

### ⚠️ CORS permissif en développement

En dev, toutes les origines sont acceptées. Vérifier que `FRONTEND_URL` est bien
configuré en production.

### ⚠️ Balance en clair côté backend

La route `GET /api/yield/balance/:userId` déchiffre le solde MPC et le renvoie en clair
via HTTPS. C'est un compromis nécessaire (incompatibilité Arcium + React Native).

- **Risque** : Le backend voit les soldes en clair
- **Mitigation** : Auth JWT obligatoire, HTTPS, le backend est notre infra
- **Alternative future** : Si Arcium fournit un SDK compatible RN, migrer le déchiffrement côté client

### ⚠️ Dedup en mémoire (scanner)

Le Set de déduplication des signatures webhook est en mémoire (max 5000).
En cas de redémarrage du serveur, des doublons peuvent être retraités.

- **Recommandation** : Migrer vers Redis SET pour persister entre redémarrages
- **Impact actuel** : Faible — les transactions MPC sont idempotentes (le programme on-chain rejette les callbacks déjà exécutés)

---

## Recommandations pour la production

### Priorité haute

| # | Action | Effort |
|---|--------|--------|
| 1 | Vérifier `NODE_ENV=production` sur tous les serveurs | 5min |
| 2 | Configurer `FRONTEND_URL` pour CORS restrictif | 5min |
| 3 | HTTPS obligatoire (reverse proxy nginx/caddy) | 1h |
| 4 | Migrer dedup signatures vers Redis | 30min |
| 5 | Rotation clé `HELIUS_WEBHOOK_SECRET` | 15min |

### Priorité moyenne

| # | Action | Effort |
|---|--------|--------|
| 6 | HSM/KMS pour `VAULT_AUTHORITY_PRIVATE_KEY` | 2-4h |
| 7 | Ajouter `express-slow-down` pour brute force progressif | 30min |
| 8 | Monitoring alertes sur erreurs MPC (PagerDuty/OpsGenie) | 1h |
| 9 | Backup automatisé MongoDB | 1h |
| 10 | Logs centralisés (Datadog/Grafana Loki) | 2h |

### Priorité basse

| # | Action | Effort |
|---|--------|--------|
| 11 | Audit dépendances npm (`npm audit`) régulier | CI/CD |
| 12 | Magic link token dans URL → passer en POST body | 1h |
| 13 | CSP plus restrictif que Helmet par défaut | 30min |
| 14 | Tests d'intégration sécurité (OWASP ZAP) | 4h |

---

## Score global

```
Authentification     ████████████████████  9/10
Validation inputs    ████████████████████  9/10
Chiffrement          ████████████████████  9/10
Webhooks             ████████████████████  9/10
Rate limiting        ██████████████░░░░░░  7/10  (dev bypass)
CORS                 ██████████████░░░░░░  7/10  (dev permissif)
Secrets management   ████████████░░░░░░░░  6/10  (env vars, pas de HSM)
Monitoring           ██████████████░░░░░░  7/10  (Sentry OK, alerting manquant)

Moyenne              ████████████████░░░░  8/10
```

Le backend est bien sécurisé pour du développement/staging. Les points restants
sont principalement liés au passage en production (infra, HSM, monitoring avancé).
