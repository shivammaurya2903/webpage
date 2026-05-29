Security Hardening and Secrets Rotation Guide

This document lists immediate steps to harden the application and rotate secrets after the recent audit.

1) Remove committed `.env` and rotate secrets
- Remove `backend/.env` from the repository history if it contains secrets. Use your git host's secret scanning guidance.
- Immediately rotate any exposed secrets: MongoDB user password, `JWT_SECRET`, `ORS_API_KEY`, `STRIPE_SECRET_KEY`, `TWILIO_*`, and `ADMIN_PASSWORD`.
- Create new secrets in your platform's secret manager (Render, Netlify, Azure Key Vault, etc.) and update environment variables there.

2) Add `.env` to `.gitignore` (already present)
- Ensure `.gitignore` includes `.env` (the repo already ignores `.env` by default). If `.env` was committed, remove it from history and rotate secrets.

3) JWT handling
- The server now sets an HttpOnly cookie for authentication only. The API no longer includes raw JWT tokens in JSON responses.
- Use server-side cookies for session authentication or implement a secure refresh token flow if your SPA requires JS-accessible tokens.

4) Content Security Policy
- CSP has been tightened to remove `'unsafe-inline'` for scripts and styles. If your frontend uses inline scripts/styles, migrate to external scripts, or adopt `nonce` or `sha256` hashes for required inline content.

5) Admin seeding
- Automatic admin seeding is disabled by default. To enable automatic admin creation or repairs from environment variables set `ALLOW_AUTO_ADMIN_SEED=true` in the environment.
- Remove any hard-coded or checked-in `ADMIN_PASSWORD`. Use a one-time interactive admin creation procedure or generate a random admin password on first-run and require rotation.

6) Uploads and file handling
- Ensure upload endpoints validate MIME types, re-encode image files, and sanitize filenames. Consider storing uploads outside the webroot and serving via signed URLs.

7) Dependencies
- Run `npm audit` and remediate critical/high advisories. Configure Dependabot or similar to keep dependencies current.

8) Further steps
- Enforce IP whitelisting and least-privilege DB users in MongoDB Atlas.
- Enable WAF and platform rate-limiting for production.
- Set up structured logging and redact sensitive fields.
- Add runtime monitoring and alerting (APM)

If you want, I can create a short checklist PR with the changes I recommend and run `npm audit` to list dependency vulnerabilities next.
