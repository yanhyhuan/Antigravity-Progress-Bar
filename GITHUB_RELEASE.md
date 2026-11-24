# Antigravity Progress Bar v0.9.16

Syncs all upstream `v0.9.11`–`v0.9.16+` engine, UI, IDE, Windows shortcut, and CLI improvements while preserving 100% of **Antigravity Progress Bar** exclusives (**colored dual-currency CNY `¥` / USD `$` & 24h hourly usage dashboard**, **3D Nailoong interactive companion**, and **Windows long-task completion notifications**):

### Desktop & Standalone IDE Upgrades (`v0.9.12`–`v0.9.16+`)
- **Antigravity `2.35.0` Full Compatibility & 3D Nailoong Anti-Flicker Fix:** Supports all 21 live `2.35.0` `MODEL_PLACEHOLDER_M400..M681` model aliases (`Claude Opus/Sonnet 5.5`, `Gemini 4 Neon/Carbon/Argon/Hydrogen` incl. `XHigh`, `Orchestrator (Neon|Carbon|Argon)`), `.surface-composer` & `[data-side-panel-composer]` DOM layouts, and MUI Base UI popups (`[data-base-ui-portal]`, `[data-select-popup]`, `[data-hover-card-popup]`); eliminates live **3D Nailoong** fast-forward twitching and compositor flicker via a generation-guarded single-`requestAnimationFrame` scheduler (fixing Rim-Patrol `position() -> ensureLoop()` loop multiplication), sub-stepped spring physics, pinned `ImageBitmap` offscreen double-buffering, spatial/temporal collision hysteresis, and zero-churn dirty-guarded `dataset` writes.
- **Manual Minimal / Full Inline Bar Collapse (`stripMode`):** Toggle between the full status bar and an ultra-compact **Minimal bar** (`< ○ 47%`) directly from the strip chevron or context-card footer (persisted across reloads without flash, compressing smoothly down to `24px` in narrow/subagent panes), coordinated cleanly with the **3D Nailoong** mascot.
- **Anti-Disappear & Cold-Start Polish:** Keeps `#ag-pulse-status-bar` mounted with its last live metrics across transient 15s bridge timeouts, full IPC queues (`inflight >= 8`), and single CDP heartbeat timeouts; shows `Connecting to Antigravity…` / `Loading quota…` on initial cold start; and eliminates idle quota-window `resetAt` flicker.
- **Persistent Incremental SQLite Usage Index + 24h Hourly Buckets:** Replaces O(history) memory aggregation with `.usage-index-v1.sqlite` (`SCHEMA_VERSION = '2-hours-v1'`, bounded page cache, corrupt-DB self-healing, `maxWaitMs = 350ms` & `busy_timeout = 250ms` non-blocking worker offload, active `RUNNING` session LRU protection, and no `--max-old-space-size=192` crash cap) — natively aggregating **120-day 24-hour hourly buckets** (`day.hours[0..23]`).
- **Hybrid USD Cost-Space Quota Estimator & Thinking-Tier Merging:** Computes 5-hour and weekly full-capacity estimates in both token and official API USD cost space (`QuotaEstimator` + `compat/pricing.cjs`, plus a 5th `Est. weekly` `≈$...USD` / CNY overview card), merges model thinking/effort tiers & Orchestrator codenames with hover per-tier breakdown tooltips and bounded `K/M/B/T` table formatting inside the **colored dual-currency CNY/USD dashboard**, and accurately routes cross-vendor `Orchestrator <Planner>` models (`Orchestrator Claude Opus ...` → `Claude / GPT`).
- **Antigravity `2.34.0+` Daemon, `RPC_RESTRICTED` & Windows Shortcut Hardening:** Discovers `~/.gemini/antigravity/daemon/{ls,hub}_*.json` and Remote SSH/WSL headless hubs, preserves verified sidecar connections on single-RPC HTTP `403` restrictions with `transcript.jsonl` streaming fallback (`TranscriptReader.readMetrics`), resolves Windows Known Folders / `OneDrive*\Desktop`, and stages Unicode/Chinese `.lnk` shortcut updates via ASCII temp paths.
- **Standalone IDE VSIX Packaging Fix:** Bundles `compat/host-theme.mjs`, `compat/pricing.cjs`, `usage-index.mjs`, `quota-estimator.mjs`, and `pricing.mjs` into `antigrative-dashboard-ide-0.9.16.vsix`, verified by unpacked relative-import checks and real Node ESM startup tests.

### Antigravity CLI (`agy`) `v0.9.16` Upgrade
- **Responsive Status Line & Local Ledger:** Shows context occupancy, conversation tokens (`↑`/`↓`), universal cache hit rate, estimated speed (`≈ t/s`), cost, grouped quotas (Gemini, Claude/GPT, Argon weekly), and `Turn` / `Last turn` summaries backed by a privacy-safe hashed local ledger.
- **Zero-Quota `#usage` Hook & Terminal Report:** Type `#usage` (`#u`, `#用量`, `##`) inside `agy` to view conversation, today/7d/30d, 14-day sparkline, and model statistics locally without a model call (or run `python manage.py usage-cli [--watch]`), with Termux `android` support, automatic legacy Windows console ASCII fallback, fast `.cmd` launchers, and `--doctor`.

## Install or Update

- **Antigravity Custom Plugin Marketplace:** Add `https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/marketplace.json` in **Antigravity → Customizations → Plugins**.
- **One-Line PowerShell Install (Windows):**
  ```powershell
  irm https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/install.ps1 | iex
  ```
- **In-App Update:** Open **Context details → `⋯` → Check for updates** inside Antigravity to update directly from `yanhyhuan/Antigravity-Progress-Bar`, then restart Antigravity once.
- **Standalone IDE (VSIX):** Download `antigrative-dashboard-ide-0.9.16.vsix` and select **Install from VSIX…**, then restart the IDE with `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1`.
- **Antigravity CLI (`agy`):** Extract `antigrative-dashboard-0.9.16.zip` and run `python manage.py install-cli` (`python3` on Linux/macOS; add `--no-hook` to skip `#usage`).
