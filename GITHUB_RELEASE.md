# Antigravity Progress Bar v0.9.18

Syncs upstream `v0.9.17`–`v0.9.18` **Remote-SSH live status bar support** and **standalone Antigravity IDE launch-flag self-healing** while preserving 100% of **Antigravity Progress Bar** exclusives (**Antigravity `2.35.0` model aliases**, **colored dual-currency CNY `¥` / USD `$` & 24h hourly usage dashboard**, **3D Nailoong interactive companion**, and **Windows long-task completion notifications**):

### What's New in `v0.9.18` (`v0.9.17`–`v0.9.18`)
- **Live Inline Status Bar in Desktop App `(SSH: <host>)` Windows:** Adds a zero-dependency loopback RFC 1928 SOCKS5 client (`sidecars/panel/socks5.mjs`) and automatic local `ssh -D` tunnel + non-interactive `ssh -T ... sh -s` `stdin` remote discovery (`sidecars/panel/ssh-remote.mjs`, `BatchMode=yes`), safely isolating execution from `zsh` / `bash` / `fish` / `csh` login shells, globbing pitfalls, and login banners. Local and remote windows run in isolated contexts (`localContext` / `remoteContexts`) while merging remote token usage into your local same-account SQLite ledger and sharing live CNY `¥` / USD `$` pricing.
- **Standalone Antigravity IDE Remote-SSH Support:** Validates `vscode-remote+ssh-remote` webviews and official remote `.antigravity-ide-server` bridge scripts (`ide/webview-targets.mjs`), pairing remote `daemon/{hub,ls}_*.json` credentials (`agy 2.35+` compatible) against locally forwarded `backendPort` endpoints (`ide/remote-client.mjs`, `ide/main.mjs`, toggleable via `antigrativeDashboard.ide.remoteSsh`).
- **Stale `DevToolsActivePort` Probing & IDE Launch-Flag Self-Healing:** Probes `127.0.0.1:<port>` TCP liveness before spawning the IDE collector so stale `DevToolsActivePort` files left behind after IDE updates no longer spin in `reconnecting`, and adds cross-platform IDE shortcut/launcher detection and repair (`ide/launch-self-heal.mjs`, `antigrativeDashboard.ide.autoConfigureLaunch`, and `Antigrative Dashboard: Repair IDE Launch Flags`).

## Install or Update

- **Antigravity Custom Plugin Marketplace:** Add `https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/marketplace.json` in **Antigravity → Customizations → Plugins**.
- **One-Line PowerShell Install (Windows):**
  ```powershell
  irm https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/install.ps1 | iex
  ```
- **In-App Update:** Open **Context details → `⋯` → Check for updates** inside Antigravity to update directly from `yanhyhuan/Antigravity-Progress-Bar`, then restart Antigravity once if needed.
- **Standalone IDE (VSIX):** Download `antigrative-dashboard-ide-0.9.18.vsix` and select **Install from VSIX…**, then fully quit and reopen the IDE (or run `Antigrative Dashboard: Repair IDE Launch Flags`).
- **Antigravity CLI (`agy`):** Extract `antigrative-dashboard-0.9.18.zip` and run `python manage.py install-cli` (`python3` on Linux/macOS; add `--no-hook` to skip `#usage`).
