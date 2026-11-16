# PC background app + private phone access

## Launch without a black console window
Double-click `revenue_factory/windows/start-app-hidden.vbs`. It starts the Node.js server as a hidden **Windows user process** and opens your browser. The app still runs on the PC; the PC must remain on, awake and signed in. Use `windows/stop-hidden.ps1` to stop only the tracked process. Logs are written to `revenue_factory/private/background-{out,error}.log`.

Optional: right-click `windows/install-autostart.ps1` → Run with PowerShell. It adds a **user startup shortcut** (no elevated privileges). At Windows sign-in it runs silently, but will not launch while logged out. Removing the Revenue Factory shortcut from the Startup folder reverses this.

## Open safely on your own phone (away from the home Wi-Fi too)

1. Install [Tailscale for Windows](https://tailscale.com/download/windows), sign in to your own tailnet.
2. Install Tailscale on your mobile phone and sign into the same tailnet. **Do not use Tailscale Funnel** (public).
3. Run `windows/enable-phone.ps1` from Windows Terminal **as Administrator**. Tailscale may prompt you to enable its HTTPS certificates. The command configures `tailscale serve --bg 8040`, sharing ONLY inside your Tailscale network.
4. Close any existing foreground Revenue Factory console, run `windows/stop-hidden.ps1` if needed, then double-click `windows/start-app-hidden.vbs`.
5. Open the reported `https://your-device.your-tailnet.ts.net/app` address from your phone. Bookmark or Add to Home Screen. Phone login uses your **existing** administrator/customer account.
6. The server only listens on **127.0.0.1** on Windows; Tailscale Serve provides a private HTTPS reverse proxy. The backend checks the exact configured host, HTTPS header and loopback proxy source. No router port-forwarding is needed.

Tailscale Serve is a **private administrative access workflow**, not a public customer storefront. For unrelated customers, deploy a separately authenticated, publicly hosted instance and implement payment/security operations before launch.

**Important:** A Tailscale address works only while the PC, Tailscale and your phone are connected. This does NOT make the product cloud-hosted or 24/7. Existing unfinished orders still need the PC's ShortsAI, FFmpeg and TTS dependencies. The first local administrator account is still created at `http://127.0.0.1:8040/app` on the PC.

Disable remote access: run `windows/disable-phone.ps1` as Administrator, and restart the hidden app. Do not share your Tailscale credentials with customers.

If Windows refuses PowerShell script execution, run via a terminal using `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows\enable-phone.ps1"` after inspecting the script. Do not run unknown scripts from other sources.

## Security notes
This is access only through a private tailnet, NOT public hosting. Tailnet access policy controls which devices can reach the service, and app authentication still applies. No secrets or credentials are written to GitHub. Never copy the `private/` folder into a repository.
