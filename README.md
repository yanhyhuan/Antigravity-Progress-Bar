<div align="center">

<img src="docs/assets/hero.png?v=0.9.1" width="100%" alt="Antigravity Progress Bar: live throughput, cache hit rate, and context usage beside the model selector.">

# Antigravity Progress Bar

Compact inline token throughput, cache hit rate, context window, and quota forecasts right beside the Antigravity model selector — enhanced with **CNY / USD cost analytics**, **24h hourly activity**, **3D Nailoong companion**, and **Windows task completion notifications**.

[![Version 0.9.16](https://img.shields.io/badge/version-0.9.16-91adff?style=flat-square&labelColor=252936)](CHANGELOG.md)
[![Platforms](https://img.shields.io/badge/host-Windows%20%7C%20Linux%20%7C%20macOS-83d8b9?style=flat-square&labelColor=252936)](COMPATIBILITY.md)
[![Antigravity 2.34.0](https://img.shields.io/badge/Antigravity-2.34.0-c5a0ff?style=flat-square&labelColor=252936)](COMPATIBILITY.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-d4d9e6?style=flat-square&labelColor=252936)](LICENSE)

[Preview](#preview) · [Features](#features) · [Install](#install) · [Manage & Update](#manage-and-update) · [Task Notifications](#windows-task-notifications) · [IDE & CLI](#standalone-ide-and-cli) · [Metrics & Privacy](#metrics-and-privacy) · [FAQ](#faq)

</div>

---

## Preview

<img src="docs/assets/responsive.png?v=0.9.1" width="100%" alt="Adaptive three-icon layout in narrow panes and independent subagent strip.">

<table>
<tr><th width="50%">Speed &amp; Token Cache</th><th width="50%">Context Window &amp; Quota Forecast</th></tr>
<tr>
<td width="50%" valign="top"><img src="docs/assets/speed.png?v=0.9.1" width="100%" alt="Generation speed detail card"><br><img src="docs/assets/widget.png?v=0.9.1" width="100%" alt="Token usage and cache detail card"></td>
<td width="50%" valign="top"><img src="docs/assets/context.png?v=0.9.1" width="100%" alt="Context occupancy, 5h and weekly quota forecasts, and UI language switcher"></td>
</tr>
</table>

<table>
<tr><th width="50%">Daily, Weekly &amp; 24h Activity</th><th width="50%">Model Breakdown &amp; Cost Sorting</th></tr>
<tr>
<td width="50%"><img src="docs/assets/usage-overview.png?v=0.9.1" width="100%" alt="Token usage overview with contribution heatmaps and scope toggle"></td>
<td width="50%"><img src="docs/assets/usage-details.png?v=0.9.1" width="100%" alt="Model usage breakdown with day, week, and month controls"></td>
</tr>
</table>

---

## Features

- **Inline Status Strip, Minimal Bar Collapse & Smooth Speed Card** — Displays weighted session TPS, last-request TPS, peak speed, average TTFT, and model/tool durations without leaving the chat input. Switch between **Pixel Cat** and **Minimal** speed card styles (both with a smooth monotone-spline waveform), or collapse the strip into an ultra-compact **Minimal bar** (`< ○ 47%`, compressing down to `24px` in narrow/subagent panes) with one click. Cold-start and transient reconnect states keep your last live numbers visible without disappearing.
- **Context Window & Hybrid USD Cost-Space Quota Forecasts** — Tracks host-reported context occupancy (`75%` warning / `90%` critical ring colors) alongside a recorded compaction badge (`🗜 N×`). Automatically matches **Gemini**, **Gemini (Argon)**, and **Claude / GPT** quota buckets (accurately routing cross-vendor `Orchestrator` sub-planners, `Neon` codenames, and `(XHigh)` / `(Max)` effort variants in Antigravity `2.34.0+`), showing 5-hour and weekly reset countdowns, linear depletion forecasts, and hybrid Bayesian full-capacity estimates calibrated in both token and official API USD cost space.
- **CNY (`¥`) / USD (`$`) Cost & 24h Usage Dashboard** — Backed by a persistent incremental SQLite index (`.usage-index-v1.sqlite`) for instant O(1)-memory summaries across **All local** traffic or the **Current account**. Includes **Daily**, **Weekly**, and **24-hour Hourly** colored stacked bar views (120 days of hourly buckets), automatic 24h-cached exchange-rate and OpenRouter model pricing sync with offline fallbacks, weekly quota USD/CNY full-capacity KPI card (`≈$...USD`), automatic model thinking-tier merging with hover per-tier breakdown tooltips, `K/M/B/T` compact table formatting, column sorting, component toggles (`Uncached` / `Cache read` / `Output`), `Alt+Click` model isolation, `<0.1%` trace folding, and bar click drill-down.
- **3D Nailoong Interactive Companion** — Built-in 3D video-atlas mascot perched on the composer rim across all models, featuring hover speech hints, click interactions, drag-down rim-cling, double-click backflips, coding-glasses + laptop animations while tasks are running, and right-click controls. Automatically steps aside for open detail cards, narrow panes, subagent boxes, or modals.
- **Windows Long-Task Completion Alerts** — Bundled `Stop` hook sends a native Windows toast notification and plays a sound/voice alert when long-running turns finish (default `≥ 30s`) or stop on error, ignoring quick Q&A turns and manual cancellations.
- **Antigravity `2.34.0+`, Remote SSH/WSL Hub & Oversized Sessions** — Supports `2.34.0+` daemon discovery (`~/.gemini/antigravity/daemon/`), headless Remote SSH/WSL hubs, `RPC_RESTRICTED` HTTP `403` resilience with `transcript.jsonl` streaming fallback, and delegated subagent token aggregation. Oversized trajectories stream through a bounded background SQLite worker without blocking live refreshes.
- **Built-in UI Languages** — Switch dashboard labels anytime between **English**, **简体中文**, and **繁體中文** at the bottom of the Context card or in the Usage Dashboard header.

---

## Install

Supported on **Windows, Linux, and macOS** with **Antigravity Desktop 2.21.1 – 2.34.0+** and **Python 3.10+**. Zero third-party `pip` or `npm` dependencies are required; the collector runs on Antigravity's bundled Node.js runtime.

### Option 1: Antigravity Custom Plugin Marketplace

Add the following catalog URL in **Antigravity → Customizations → Plugins**:

```text
https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/marketplace.json
```

### Option 2: One-Line PowerShell Install (Windows)

Downloads the latest release, verifies its SHA-256 checksum, installs the plugin, and configures your Antigravity desktop shortcuts automatically:

```powershell
irm https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/install.ps1 | iex
```

### Option 3: Ask Antigravity Agent

Paste into an Antigravity chat:

```text
Please install and enable https://github.com/yanhyhuan/Antigravity-Progress-Bar
```

### Option 4: Clone & Install Manually

```powershell
git clone https://github.com/yanhyhuan/Antigravity-Progress-Bar.git
cd Antigravity-Progress-Bar
python manage.py install
```

On Linux or macOS, run `python3 manage.py install` (or `sh install.sh`). Never run the installer with `sudo`.

After installing, **fully quit and reopen Antigravity** from your shortcut or launcher so the new runtime loads.

> **How inline mounting works on Antigravity 2.33.0+ & 2.34.0+:**  
> Antigravity has no public DOM slot beside the model selector, so the sidecar attaches the Shadow DOM strip over the host's loopback CDP port (`127.0.0.1`) and reads local metrics via the official Sidecar SDK loopback environment (`ANTIGRAVITY_LS_ADDRESS` / `ANTIGRAVITY_CSRF_TOKEN`) and `2.34.0+` daemon files without modifying `resources/app.asar`. Starting with `2.33.0`, remote debugging is opt-in: `manage.py install` and the active sidecar automatically configure user-owned Windows `.lnk` shortcuts (including redirected Known Folders, `OneDrive*\Desktop`, `AntigravityLauncher.exe` proxy shortcuts, and non-ASCII/Chinese paths), Linux `.desktop` entries, and a lightweight macOS launcher at `~/Applications/Antigravity (Dashboard).app` with `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1`.

---

## Manage and Update

### In-App Updates

Open **Context details → bottom-right `⋯` → Check for updates** inside Antigravity to verify and install new releases from `yanhyhuan/Antigravity-Progress-Bar` while keeping all saved statistics and preferences intact.

### CLI Lifecycle Commands

Run from the repository directory (`python3` on Linux/macOS):

| Action | Command | Description |
| --- | --- | --- |
| Install / Update | `python manage.py install` | Install runtime files, configure user launch entry points, and keep saved data |
| Launch Host | `python manage.py launch` | Launch Antigravity Desktop with loopback debugging flags (`--restart` supported on macOS) |
| Check Status | `python manage.py status` | Inspect install state, host version (`2.34.0+`), launch shortcut config, and attachment health |
| Disable | `python manage.py disable` | Hide the inline strip on the next poll without uninstalling |
| Enable | `python manage.py enable` | Re-enable the plugin and restore the strip |
| Panel Only | `python manage.py install --panel-only` | Run only the native Side Panel extension without inline composer attachment |
| Uninstall | `python manage.py uninstall` | Remove plugin runtime and managed launch flags while keeping historical data |
| Install `agy` CLI | `python manage.py install-cli` | Install `agy` status line & local `#usage` hook (`--no-hook` to skip hook) |
| `agy` CLI Report | `python manage.py usage-cli` | Print local CLI usage report in terminal (`--watch` for live refresh) |

To open the fallback **Side Panel** inside Antigravity, toggle the right auxiliary pane and select **`+` → Extensions → Antigravity Progress Bar**.

---

## Windows Task Notifications

On Windows, the bundled `Stop` hook notifies you when a turn finishes after `minSeconds` (default `30s`) or stops due to an error. Customize preferences in `~/.gemini/config/plugins/antigravity-pulse/notify-settings.json` (preserved across updates and reinstalls) — or simply ask the Antigravity agent to adjust them for you:

```json
{
  "enabled": true,
  "minSeconds": 30,
  "notifyOnError": true,
  "sound": true,
  "speak": true,
  "speakVolume": 1.0
}
```

---

## Standalone IDE and CLI

### Antigravity Standalone IDE (VSIX)

Download `antigrative-dashboard-ide-0.9.16.vsix` from [Releases](https://github.com/yanhyhuan/Antigravity-Progress-Bar/releases) and select **Install from VSIX…** in the Antigravity IDE Extensions view. Fully quit the IDE and start it with `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1`. See [ide/README.md](ide/README.md) for full setup and rollback details.

### Antigravity CLI (`agy`) Status Line & `#usage` Hook

Displays context occupancy, conversation tokens (`↑`/`↓`), cache hit rate, estimated generation speed (`≈ t/s`), cost, grouped quotas (Gemini, Claude/GPT, Argon weekly) with reset countdowns, and a live `Turn` / `Last turn` summary row in the official `agy` CLI `statusLine` — supporting `en` / `zh-CN` / `zh-TW`, narrow 40-column Termux screens, fast Windows `.cmd` launchers, and automatic ASCII glyph fallback on legacy Windows consoles. Inside `agy`, send `#usage` (`#u`, `#用量`, `##`) for instant local usage details without calling the model:

```powershell
node cli/statusline.mjs --preview
node cli/statusline.mjs --doctor
python manage.py install-cli
python manage.py usage-cli
```

Requires Node.js 20+. See [docs/CLI.md](docs/CLI.md) for options (`--no-hook`, `--no-ledger`, `--ascii`), local hashed ledger details, and model coverage.

![Antigravity CLI status line](docs/assets/cli-conversation.png?v=0.8.4-cli-1)

---

## Metrics and Privacy

| Metric | Basis |
| --- | --- |
| **Session / Latest TPS** | Response tokens ÷ streaming duration (anomalous buffered spikes and uncertain tool-only windows are filtered; see [docs/TPS.md](docs/TPS.md)) |
| **TTFT / Model / Tool Time** | Average time to first token; cumulative model time (`TTFT + stream`); merged non-overlapping tool execution intervals |
| **Cache Hit Rate** | `cacheReadTokens ÷ (uncachedInput + cacheRead + cacheWrite)`, token-weighted across validated requests |
| **Context Window** | Latest request-start `estimatedTokensUsed / maxContextTokens` reported by the host ([docs/CONTEXT_LIMITS.md](docs/CONTEXT_LIMITS.md)) |
| **5h / Weekly Quotas** | Live account `remainingFraction` and `resetTime`, paired with linear pace projections and hybrid token + USD cost-space capacity estimates |
| **Estimated Cost** | Local token counts × OpenRouter model pricing (`prompt`, `completion`, `cacheRead`, `cacheWrite`), converted to CNY (`¥`) in Chinese locales or USD (`$`) in English; weekly quota full-capacity equivalence uses official API USD list prices (`compat/pricing.cjs`) |

**Local-only storage:** All RPC calls stay strictly on `127.0.0.1` loopback. Per-conversation snapshots (`history-v1`) and incremental SQLite + JSON daily/hourly ledgers (`usage-v1`) live under `~/.gemini/antigravity/sidecar_data/antigravity-pulse/panel/data/` and store only timestamps, model names, hashed scopes, and numeric token counters — **never** prompts, replies, conversation titles, emails, or credentials. Pricing sync fetches only public model rates from `openrouter.ai` and `open.er-api.com` once every 24 hours without sending any user or usage data, falling back cleanly offline. See [docs/USAGE.md](docs/USAGE.md), [docs/LONG_CONVERSATIONS.md](docs/LONG_CONVERSATIONS.md), and [docs/ROBUSTNESS.md](docs/ROBUSTNESS.md).

---

## FAQ

<details><summary><strong>The inline strip did not appear after installing or updating Antigravity.</strong></summary>

1. Make sure you **fully quit** Antigravity (check the system tray) and reopen it from your configured shortcut or run `python manage.py launch`.
2. Run `python manage.py status` to verify `"hostVersion"`, `"configured": true`, and `"inlineIntegration"`.
3. Check `~/.gemini/antigravity/sidecar_data/antigravity-pulse/panel/logs/sidecar.log` if needed.

</details>

<details><summary><strong>Why is TPS blank (`—`) in a brand-new chat?</strong></summary>

No model response has completed in that conversation yet. Rather than carrying over stale TPS from an earlier chat, the strip waits until the first response finishes.

</details>

<details><summary><strong>How do compact windows and Minimal Bar mode behave?</strong></summary>

Click the chevron on the strip (or choose **Minimal** at the bottom of the Context card) to collapse the strip into a compact `< ○ 47%` pill at any time. In Full mode, when composer width tightens, text counters smoothly collapse into three clickable icons (Speed, Cache, Context) and hide only if even the icons (`24px` in Minimal mode) would collide with host controls, restoring automatically when widened.

</details>

---

## Development

```powershell
npm test
node --test ide/tests/*.test.mjs
python -m unittest discover -s tests -v
python manage.py package
python ide/package.py
python tools/sync-marketplace.py
python tools/publish-release.py
```

Optional README asset rendering uses headless Edge/Chromium via `node tools/render-readme-assets.mjs` (and interactive CLI HTML preview via `node tools/preview-cli.mjs`). See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), [COMPATIBILITY.md](COMPATIBILITY.md), [docs/UPDATES.md](docs/UPDATES.md), and [CHANGELOG.md](CHANGELOG.md).

---

## Credits & License

Enhanced and maintained by [@yanhyhuan](https://github.com/yanhyhuan), building upon [ATtacK030130/antigrative-dashboard](https://github.com/ATtacK030130/antigrative-dashboard). Released under the [MIT License](LICENSE). Not affiliated with or endorsed by Google or Antigravity.
