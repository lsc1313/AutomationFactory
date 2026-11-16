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

Requires Node.js >=20, FFmpeg in PATH and a Korean font (Windows Malgun automatically discovered). **On a fresh local PC, administrator account setup is available directly in the browser, without environment variables.** This setup API is blocked for public hosts and non-local connections.

```powershell
$env:REVENUE_ADMIN_EMAIL="admin@example.com"
$env:REVENUE_ADMIN_PASSWORD="INSERT_YOUR_LONG_RANDOM_PASSWORD_HERE"
node revenue_factory/app.mjs
# Open http://127.0.0.1:8040/app
```

Windows command file `revenue_factory/start-app-windows.cmd` can now be double-clicked **without admin environment variables** on first local launch. Open the shown URL, create administrator credentials in the secure localhost-only setup screen, then log in. On a public server, bootstrap via environment variables is still mandatory. Actual credentials must not be committed to GitHub.

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
## Director-powered production (replaces previous silent fixed-frame demo)

Revenue Factory now **requires 2–6 distinct customer-authorized product photos**. No-photo and duplicate-photo orders are rejected before payment confirmation. The production worker loads **only `createShoppingDirector`** from your local ShortsAI_CLEAN checkout, in a child process. It does **not** call `createShort`, so it never publishes to YouTube, Instagram, or Threads. The isolated worker generates separate scene audio using the `edge-tts` CLI, renders distinct motion-enabled product scenes with FFmpeg, adds scene captions, and concatenates the results into a **narrated 15–60 second MP4**. Missing voice, unsupported product claims, or media shortages cause a FAILED job, not a falsely successful delivery. Human advertising review remains mandatory.

Prerequisites on the PC that runs production:

- `REVENUE_SHORTSAI_HOME`: absolute directory of your **locally installed** `ShortsAI_CLEAN` checkout (where `modules/shopping/director.js` exists).
- Node dependencies installed in that ShortsAI checkout (`npm install` there if needed); its **AI provider credentials configured in its own approved environment**.
- FFmpeg + FFprobe on PATH, Korean system fonts, and the existing ShortsAI-compatible **Python `edge-tts` command** on PATH. Check `edge-tts --help` before ordering.
- The app and ShortsAI can run from different folders. Ads do not use existing ShortsAI media/queues or scheduled upload jobs. The director reads customer details as input to your configured AI provider, so gain customer consent for that processing.

After downloading the updated branch, set `REVENUE_SHORTSAI_HOME` in the command prompt running the app, for example `set "REVENUE_SHORTSAI_HOME=C:\\ShortsAI_CLEAN"`. Restart the app. The old NEEDS_REVIEW jobs remain old templates and **must not be sold as finished ads**; use new orders with multiple relevant product photos. New output is based on the ShortsAI Shopping Director, isolated voice generation and a safe FFmpeg render pipeline. Do not rely on an AI director or narration when offline: the job will fail visibly rather than producing a silent placeholder.

Current limits: customer media is only verified by format and duplicate detection, *not semantic visual classification*. Director output checks unsupported numeric and common risky claims but cannot guarantee all copy claims or product-photo correspondence. A human must inspect the final video. Automatic payment, mass production at scale, and background music licensing are separate commercial readiness work.

The in-app header now reports whether the local ShortsAI Director path is configured; `ready` means that its file exists, **not** that an AI account, free quota or TTS voice provider is operational. A paid customer campaign must be test-rendered and visually approved before public sales.

The customer-specific creative Director reuses the ShortsAI AI gateway and Shopping Director scene normalization but explicitly replaces the affiliate/curator advertising instructions with a B2B commissioned-ad prompt. It rejects orders without two factual features and does not insert unrelated stock photography. This is a dedicated director adapter, not an invocation of the uploader-enabled `createShort` function.

## Full-screen vertical layout (2026-11-17)
Video defaults to 1080×1920 (true 9:16), using a blurred copy of the SAME customer photo behind the original product image, no solid black bars. Stronger zoom/pan, no opaque subtitle rectangle; caption outlined instead. Player CSS now respects actual 9:16 dimensions. Low-spec PC may set `REVENUE_VIDEO_WIDTH=720` for 720×1280. Existing videos remain unchanged: submit a new job to see the revised rendering.

## Easy Windows desktop and private phone access

- **No black terminal:** double-click `revenue_factory/windows/start-app-hidden.vbs`; the backend runs as a hidden user process and opens the browser. Logs and its PID live under `revenue_factory/private/`.
- **Start with Windows:** run `revenue_factory/windows/install-autostart.ps1` once, which adds a per-user Startup shortcut. The Windows user must be signed in.
- **Personal mobile editing/administration:** use Tailscale on Windows and your phone; follow `revenue_factory/PHONE-AND-BACKGROUND.md`. On Windows run `windows/enable-phone.ps1` from an elevated terminal once, then restart the hidden app. Tailscale Serve provides HTTPS access only within your tailnet, not public internet.
- **PC must remain on and awake** for phone access. For always-on public customers, a separate hosted deployment and stronger operational safeguards are required.
- The background launcher and Tailscale setup are Windows-specific and must be verified on the user's PC; GitHub Actions verifies Node API behavior but does not install or execute Tailscale on Windows.

## 2026-11-17: Director timeout issue on mobile
Owner video preview reported `node.exe 실행 시간 초과` after a ~90 second default during ShortsAI AI provider calls. The Director subprocess limit is now 300 seconds by default (configurable `REVENUE_DIRECTOR_TIMEOUT_MS`, maximum 600000 ms). This is a bounded allowance for legitimate multi-provider retries, not a guarantee a provider will respond. The per-job output folder now contains `phase.txt` and `director-run.log` (when the child exits) for failure diagnosis; do not publish logs because AI providers may print sensitive request details. Failed preview can be retried from the operator order list after replacing code and restarting the PC backend. No new photos are required for the retry since original order input is preserved for failed jobs.
