# AI-DLC and Spec-Driven Development

Kiro-style Spec Driven Development implementation on AI-DLC (AI Development Life Cycle)

## Context Recovery

IMPORTANT: At session start, read all .md files in the /docs/ directory to restore full project context from the previous session.

## Current State

- **Branch**: `fix/security-audit-critical-issues` (PR pending review)
- **Status**: Security audit complete, 12/18 fixes applied, PR created
- **Last updated**: 2026-02-04

## Task Progress

- [x] Full codebase exploration and architecture mapping
- [x] Security audit completed (IDOR, auth, validation, CORS, rate limiting)
- [x] Vulnerability report generated with severity ratings
- [x] Fix CRITICAL: IDOR vulnerabilities in wallet/private balance endpoints
- [x] Fix CRITICAL: Add ownership validation to withdrawal service
- [x] Fix CRITICAL: Add input validation to /api/users/auth
- [x] Fix HIGH: Validate webhook payloads with Zod schema
- [x] Fix remaining issues (#7, #8, #11, #12, #15, #17)
- [x] Create PR for security fixes
- [ ] Merge PR after review
- [ ] Production hardening (CORS, rate limiting, headers, HTTPS)

## Security Fixes Applied

| # | Issue | File | Fix |
|---|-------|------|-----|
| 1-2 | IDOR wallet access | walletController.ts | `verifyWalletOwnership()` |
| 3 | IDOR withdrawal | PrivacyWithdraw.ts | Use `userId` directly |
| 4 | Missing validation | validations.ts | `authUserSchema` |
| 6 | Webhook validation | WebhookHeliusController.ts | `heliusWebhookPayloadSchema` |
| 7 | Error disclosure | errorHandler.ts | Default to production mode |
| 8 | Hardcoded path | server.ts | `path.join(__dirname, ...)` |
| 11 | Timing attack | authController.ts | 500ms constant-time |
| 12 | Unbounded limit | walletController.ts | Bound 1-100 |
| 15 | Hardcoded email | magicLinkService.ts | Use user's email |
| 17 | Body size limit | server.ts | 10kb limit |

## Deferred for Production

- #5 CORS restriction
- #9-10 Rate limiting
- #13 HTTPS enforcement
- #14 Magic link token in URL
- #16 Console logging cleanup
- #18 Security headers (helmet)

## Project Context

### Paths
- Steering: `.kiro/steering/`
- Specs: `.kiro/specs/`

### Steering vs Specification

**Steering** (`.kiro/steering/`) - Guide AI with project-wide rules and context
**Specs** (`.kiro/specs/`) - Formalize development process for individual features

### Active Specifications
- Check `.kiro/specs/` for active specifications
- Use `/kiro:spec-status [feature-name]` to check progress

## Development Guidelines
- Think in English, generate responses in English. All Markdown content written to project files (e.g., requirements.md, design.md, tasks.md, research.md, validation reports) MUST be written in the target language configured for this specification (see spec.json.language).

## Minimal Workflow
- Phase 0 (optional): `/kiro:steering`, `/kiro:steering-custom`
- Phase 1 (Specification):
  - `/kiro:spec-init "description"`
  - `/kiro:spec-requirements {feature}`
  - `/kiro:validate-gap {feature}` (optional: for existing codebase)
  - `/kiro:spec-design {feature} [-y]`
  - `/kiro:validate-design {feature}` (optional: design review)
  - `/kiro:spec-tasks {feature} [-y]`
- Phase 2 (Implementation): `/kiro:spec-impl {feature} [tasks]`
  - `/kiro:validate-impl {feature}` (optional: after implementation)
- Progress check: `/kiro:spec-status {feature}` (use anytime)

## Development Rules
- 3-phase approval workflow: Requirements → Design → Tasks → Implementation
- Human review required each phase; use `-y` only for intentional fast-track
- Keep steering current and verify alignment with `/kiro:spec-status`
- Follow the user's instructions precisely, and within that scope act autonomously: gather the necessary context and complete the requested work end-to-end in this run, asking questions only when essential information is missing or the instructions are critically ambiguous.

## Steering Configuration
- Load entire `.kiro/steering/` as project memory
- Default files: `product.md`, `tech.md`, `structure.md`
- Custom files are supported (managed via `/kiro:steering-custom`)
