# Antigravity Progress Bar v0.9.20

- **Weekly quota estimates (upstream #26).** The dashboard calculates full capacity from the active account’s quota window and gives priority to post-reset samples. Its overview tooltip and inline strip share the same token estimate. Cost and usage changes refresh the overview even when the displayed token estimate stays the same.
- **Standalone IDE on macOS (upstream #28).** Process discovery and launch checks recognize both executable names in `Antigravity IDE.app`, including installations under paths containing spaces. Helper processes and other Electron apps are excluded.
- This release includes the draggable 3D Nailoong companion and its composer-button avoidance, CNY/USD cost analytics, 24-hour activity, Windows completion sounds, and Remote-SSH support.

## Install or Update

- **Antigravity Custom Plugin Marketplace:** Add `https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/marketplace.json` in **Antigravity → Customizations → Plugins**.
- **One-Line PowerShell Install (Windows):**
  ```powershell
  irm https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/install.ps1 | iex
  ```
- **In-App Update:** Open **Context details → `⋯` → Check for updates** inside Antigravity to update directly from `yanhyhuan/Antigravity-Progress-Bar`.
- **Standalone IDE (VSIX):** Download `antigrative-dashboard-ide-0.9.20.vsix` and select **Install from VSIX…**, then fully quit and reopen the IDE.
- **Antigravity CLI (`agy`):** Extract `antigrative-dashboard-0.9.20.zip` and run `python manage.py install-cli` (`python3` on Linux/macOS; add `--no-hook` to skip `#usage`).
