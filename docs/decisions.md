# Decision Log

Append-only log of architectural and implementation decisions.

---

## 2026-02-04: Security Audit Completed

**Context**: Full security audit of backend API requested

**Decision**: Identified 18 vulnerabilities across 4 severity levels

**Key Findings**:
1. IDOR vulnerabilities in wallet and private balance endpoints (CRITICAL)
2. Missing input validation on user registration (CRITICAL)
3. Open CORS allowing all origins (HIGH)
4. Webhook payloads not validated (HIGH)

**Rationale**: Standard pentesting methodology covering OWASP Top 10, focusing on auth bypass, IDOR, injection, and information disclosure.

**Next Steps**: Fix CRITICAL issues first, then HIGH, then MEDIUM/LOW.

---

## 2026-02-04: Architecture Documentation

**Context**: Needed to understand codebase for security audit

**Decision**: Created comprehensive architecture map in docs/architecture.md

**Covered**:
- Directory structure
- All API endpoints with auth requirements
- Authentication flow (Turnkey + MagicLink)
- Real-time events (Socket.io)
- Caching strategy (Redis)
- Environment variables

**Rationale**: Future sessions and new developers need quick reference to understand the system.

---

## 2026-02-04: Security Fixes Implemented

**Context**: Implementing fixes for security audit findings

**Decision**: Fixed 12 of 18 vulnerabilities, deferred 6 for production hardening phase

**Fixed Issues**:
1. IDOR in wallet endpoints - Added `verifyWalletOwnership()` helper
2. IDOR in private balance - Use authenticated userId for lookup
3. IDOR in withdrawal - Changed service to accept `userId` directly
4. Missing registration validation - Added `authUserSchema` with Zod
5. Webhook validation - Added `heliusWebhookPayloadSchema`
6. Error info disclosure - Default to production mode
7. Hardcoded file path - Use `path.join(__dirname, ...)`
8. Timing attack - 500ms constant-time response
9. Unbounded limit - Bound query param to 1-100
10. Hardcoded email - Send to actual user's email
11. Body size limit - Added 10kb limit

**Deferred** (dev mode, will fix for production):
- CORS restriction
- Rate limiting on auth/wallet endpoints
- HTTPS enforcement
- Magic link token exposure
- Console logging cleanup
- Security headers (helmet)

**Rationale**: Critical security issues fixed immediately. Production hardening items deferred since still in dev mode - they would interfere with local development.

**PR**: `fix/security-audit-critical-issues` (branch: f087fa1)
