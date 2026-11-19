# Antigravity Progress Bar v0.9.7

Merged release combining upstream `v0.9.7` with enhanced local usage & cost analytics:

- **CNY (`¥`) / USD (`$`) Cost Estimation & Sorting:** Automatic 24h-cached exchange rate and OpenRouter model pricing lookup with offline fallbacks for `Gemini 4 Carbon / Neon / Hydrogen`, `Claude Opus / Sonnet`, and `GPT 5.4`, plus full column sorting in Usage Details.
- **24-Hour Hourly Activity View:** Switch between **Daily**, **Weekly**, and **24h Hourly** activity in the Overview tab, retaining 120 days of per-hour breakdowns alongside quick day pills and composition bars.
- **Interactive Filtering & Drill-down:** Exclude individual token components (`Uncached` / `Cache read` / `Output`) with live strikethrough recalculation, `Alt+click` to isolate a model, hide unused models, fold `<0.1%` dormant trace models, and click any chart bar to drill down.
- **Full Upstream v0.9.7 Capabilities:** Antigravity Desktop `2.33.0+` & IDE `2.6.0` compatibility, `0.9.5` metadata-only low-memory backfill, `All local` / `Current account` scope switcher, 5h/weekly quota pace forecasts, Pixel Cat speed card, and the interactive **Neon (氖龙)** plush mascot Easter egg.

## Install or update

- **Antigravity Custom Plugin Marketplace:** Add `https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/marketplace.json` in Antigravity Custom Plugins to install directly from the UI.
- **One-line PowerShell Install (Windows):**
  ```powershell
  irm https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/install.ps1 | iex
  ```
- **In-App Update:** Use **Context details → ⋯ → Check for updates** inside Antigravity to pull updates directly from `yanhyhuan/Antigravity-Progress-Bar`.
