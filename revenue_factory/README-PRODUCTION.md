# Revenue Factory — Full pilot-ready product (v1)

## What is finished and tested

- Customer/admin account access with password hashing (scrypt), HttpOnly SameSite cookies, CSRF protection, HTTPS enforcement on public domains, rate-limited login, role-based authorization and customer isolation.
- Responsive installable PWA (desktop/mobile browsers); account login, product ad/CSV report order, status, per-order authorized download.
- Administrator customer account setup, manual bank/payment verification, one-at-a-time persistent processing queue, retry of failures, 4-step human advertisement approval.
- Product photo or no-photo → 3 SVG ad cards, factual captions/storyboard and 25-second portrait H.264 MP4 (FFmpeg + Korean fonts); delivered ZIP only after approval.
- CSV sales data → summary CSV/JSON/HTML and deliverable ZIP, formula injection protection from legacy report module.
- Single-instance transactional JSON state with atomic writes, session expiry, recovery of in-progress jobs after restart, basic audit events.
- Automated tests including end-to-end paid-order simulation (manual payment verification, video render, approval, authorization, ZIP download).

## Important product limitations

**This is a functional, self-hostable PILOT app, not yet an unconditionally production-safe SaaS for arbitrary volume.**

- **Real card/bank payment gateway is not integrated**. Product prices are demo/offer defaults; payments are marked paid only after the operator independently verifies an external payment and records the reference. No automatic refund/payment transfer, tax receipt or invoice is issued.
- Creative copy uses **optional Gemini API** when `REVENUE_GEMINI_API_KEY` is provided and falls back to offline factual templates if it is missing, over quota, or unsafe. AI claims still require human approval. Product images are supplied by seller and decorated into SVG cards. MP4 is **silent** and uses product photo/text, not AI avatar/voice or motion stock.
- Customer sign-up is **invitation/account created by admin**, not self-service public registration.
- Server must be a **single instance**, backed by a persistent disk. JSON file persistence is not a replacement for transactional database & multi-region cloud production.
- No automatic social posting, marketplace price scraping, or guarantee that marketing copy complies with a given platform's policies.
- No email delivery/notifications; users check their order status in-app.
- Real launch requires business registration/payment/refund policies, privacy policy, data retention rules, actual price and terms, appropriate consents, and secrets management.

## Fast local test (Windows)

Requires Node.js >=20, FFmpeg in PATH and a Korean font (Windows Malgun automatically discovered).

```powershell
$env:REVENUE_ADMIN_EMAIL="admin@example.com"
$env:REVENUE_ADMIN_PASSWORD="INSERT_YOUR_LONG_RANDOM_PASSWORD_HERE"
node revenue_factory/app.mjs
# Open http://127.0.0.1:8040/app
```

Windows command file `revenue_factory/start-app-windows.cmd` works after environment variables are configured. Actual credentials must not be committed to GitHub.

Optional AI copy editing: set `REVENUE_GEMINI_API_KEY` and `REVENUE_GEMINI_MODEL` to a currently supported model name (see Google Gemini API docs). API usage may incur fees and free quotas may stop generation; template fallback prevents complete interruption. For Docker use these two variables in `compose.yaml` only after adding the secret to the host environment. Keep API keys out of Git.

The operator then logs in, creates customer accounts under `운영자 관리`, and shares credentials through a secure channel. Customers can submit requests; orders remain awaiting payment until operator verification. After verification the job automatically runs. Review/approve creative packs before delivering. Reports go directly to delivery after processing.

Back up `revenue_factory/private/` and `revenue_factory/output/` together. They contain private customer data and must never be committed. Changing `REVENUE_DB`/`REVENUE_OUT` relocates those folders.

## HTTPS server / installable mobile PWA

Requires a real domain and a Linux host with public ports 80 and 443 and Docker Compose. Set the DNS A/AAAA record to your server. Do not publicly expose Node port 8040. Edit `revenue_factory/.env` or export three variables and run from `revenue_factory/`:

```bash
REVENUE_PUBLIC_HOST=studio.example.com \
REVENUE_ADMIN_EMAIL=owner@example.com \
REVENUE_ADMIN_PASSWORD='GENERATE_A_LONG_UNIQUE_SECRET' \
docker compose up -d --build
```

`compose.yaml` runs Caddy with automatic HTTPS and a single Node/FFmpeg app with a persistent Docker volume. This deployment is **not automatic**; domain and server credentials must be supplied by the operator. A local `/app` without HTTPS is available only over localhost and not from an unrelated mobile phone.

For a smartphone, open your actual HTTPS site in Chrome/Safari and use **Add to Home Screen** / **Install** (supported platform dependent). No APK/IPA is produced; native app store publication is separate.

### Minimum security steps for real customers

1. Change the bootstrap admin secret, protect the server, use only HTTPS. Admin secret is used only on first boot when admin does not exist.
2. Keep Docker volumes encrypted or with strict file permissions, take verified off-server backups and monitor disk use; rotate all compromised credentials.
3. Put real privacy policy, retention schedule, refund and service terms on your public site before collecting customer data; remove accidental PII in uploaded CSVs.
4. Configure a proper payment provider and webhook signature verification before promising automated checkout. **Never trust a browser 'paid' flag.**
5. Before scaling beyond one instance, migrate file-state transactions to PostgreSQL/SQLite and store binary assets in private object storage with expiring URLs.

## Tests

```bash
node --test revenue_factory/tests/*.test.mjs revenue_factory/app-tests/*.test.mjs
```

Existing original local operator `server.mjs` (port 8038) is still available for backward compatibility. The customer portal uses new `app.mjs` (port 8040) and its own state under `private/`.