# Antigravity Progress Bar v0.9.11

Release adapting **Antigravity Desktop 2.34.0**, syncing upstream `v0.9.8`–`v0.9.10`, and retaining all enhanced usage, cost, notification, and 3D Nailoong mascot features:

- **Antigravity Desktop 2.34.0 Adaptation:** Connects via the official Sidecar SDK `ANTIGRAVITY_LS_ADDRESS` & `ANTIGRAVITY_CSRF_TOKEN` loopback contract (fixing `Local metrics credentials are unavailable` after `2.34.0` removed CLI `--csrf_token`), supports the new `local HTTP (SDK/gRPC)` / `HTTPS (gRPC)` log banners, and accurately classifies `2.34.0` custom Orchestrator planners (`Orchestrator Claude Opus 5.5 (Max)`, `(XHigh)`, `(Max)`).
- **Context Compaction Pill & Hardened Discovery (`v0.9.8`–`v0.9.10`):** Displays recorded conversation compactions (`🗜 N×` / `🗜 N 次`) with `75%` warning ring colors, deduplicates quota errors, sanitizes PowerShell/`ps` subprocess errors across all locales, avoids idle PowerShell rescans, and supports `AntigravityLauncher.exe` Windows proxy shortcuts.
- **CNY (`¥`) / USD (`$`) Cost Estimation, 24h Hourly View & Interactive Filters:** Automatic 24h-cached exchange rate and OpenRouter pricing lookup with offline fallbacks, 120-day per-hour activity breakdowns, token component toggles, bar drill-down, **3D Nailoong** interactive companion, and **Windows task completion notifications**.

## Install or update

- **Antigravity Custom Plugin Marketplace:** Add `https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/marketplace.json` in Antigravity Custom Plugins to install directly from the UI.
- **One-line PowerShell Install (Windows):**
  ```powershell
  irm https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/install.ps1 | iex
  ```
- **In-App Update:** Use **Context details → ⋯ → Check for updates** inside Antigravity to pull updates directly from `yanhyhuan/Antigravity-Progress-Bar`.
