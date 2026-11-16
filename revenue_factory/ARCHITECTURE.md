# Revenue Factory - Phase 1 architecture

## Production safety
- Keep `AutomationFactory/main` unchanged while developing in a feature branch and PR.
- Keep `theme_factory` and all current workers isolated; do not import their runtime code.
- Keep `ShortsAI_CLEAN` and `guildcore-v6` unchanged. Video integration must use a separate adapter after testing.
- Do **not** expose the local HTTP server to the Internet. It has no user authentication.

## Implemented MVP (local, Node.js 20+)
- Product JSON validation, 3 editable SVG ad cards, storyboards, human-review flags.
- CSV sales aggregation, spreadsheet-safe exports, HTML report preview.
- Responsive local UI and installable PWA assets. Offline cache is strictly an app shell; the production API still needs the local Node process.
- No paid API, deploy, billing, remote login, autopublishing or rendered videos.

## Proposed service architecture (future work, not implemented)
- Front end: PWA with tenant login and subscription billing.
- API: authenticated project/order/resource endpoints; expiring signed file downloads.
- Queue: idempotent job lifecycle `queued -> working -> review -> approved -> delivered` with retry policy.
- AI adapters: local free-first generation where allowed, budget guard, no guarantee of free production capacity.
- Rendering: isolated FFmpeg worker, no client secrets exposed to browsers.
- Human approval: explicit verification of claims, product likeness, music/image licenses and ads disclosures before delivery.
- Native mobile: consider Android/iOS packaging only if mobile-native value merits store review. No wrappers or APK/IPA yet.

## Milestone gates
1. Git PR CI green; 13 local tests; no changes to main or existing factory.
2. 3 real authorized product briefs tested, quality review and cost logging.
3. Auth + tenant separation + storage retention policy before remote service.
4. Video adapter/rendering and review/approval queue.
5. Payments and client delivery; paid pilots before broader SaaS.

## Security & privacy
- Local server binds 127.0.0.1 only.
- Never serve external customers with the current HTTP server.
- API and generated files are never cached by the service worker.
- Use HTTPS, authentication, authorization, storage encryption/access controls, rate limiting and customer data deletion rules before remote deployment.

## Phase 1 operator product (2026-11-15)

- `server.mjs`: localhost-only HTTP API, origin guard, content serving, state transitions
- `core.mjs`: fact-based product validation, copy, three SVG designs, storyboard
- `render.mjs`: 25-second 720x1280 H.264 MP4 renderer via FFmpeg, silent, optional customer image, font compatibility
- `report.mjs`: CSV parser and aggregate reports, spreadsheet formula protection
- `workflow.mjs`: persistent on-disk job states, approval checklist, dependency-free ZIP delivery
- `ui.html`: responsive operations dashboard, job list, render and approval controls
- `sw.js`: only public UI shell cached, no customer or report data

**Non-goals:** no third-party AI promises, no remote web access, no user tenancy, no checkout, no automatic posting, no public SaaS deployment. Approval is not a substitute for legal compliance and an operator must review materials.

**Workflow:** create creative -> automatic FFmpeg render when available -> human review/approval -> delivery ZIP. Report CSV -> summary -> ZIP. Tests cover actual video generation and HTTP end-to-end flows. Windows requires FFmpeg in PATH and installed Korean font. The job directory is a per-machine, trusted-user store; customer isolation requires a later authenticated service architecture.