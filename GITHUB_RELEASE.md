# Antigravity Progress Bar v0.9.19

Fixes **3D Nailoong** overlapping **Queued Message** edit/delete (`✏️` / `🗑️`) buttons above the composer box, adds **free horizontal rim-cling dragging** with persistent position memory, and includes all `v0.9.18` Remote-SSH & IDE self-healing upgrades:

### What's New in `v0.9.19`
- **Smart Auto-Avoidance for Queued Message & Composer-Dock Buttons:** Automatically detects clickable buttons in non-scrolling composer-dock bars right above `.surface-composer` (such as queued-message `✏️` edit and `🗑️` delete buttons, pending review bars, or `/btw` controls) while ignoring scrolling chat messages — smoothly sliding **3D Nailoong** aside so your buttons stay 100% uncovered and clickable (or hiding cleanly if a full-width bar leaves no room), then returning home once cleared.
- **Drag Nailoong Left / Right Along the Composer Rim:** Grab Nailoong and drag horizontally anywhere along the top edge of the chat input box to pick your favorite spot (saved automatically across restarts), while vertical drag-to-tuck, double-click backflips, and adaptive left/right rim-patrol walks continue working seamlessly.
- **Includes All `v0.9.18` Upgrades:** Live inline status bar in Desktop App `(SSH: <host>)` windows (loopback SOCKS5 + `ssh -T ... sh -s` `stdin` discovery), standalone IDE Remote-SSH support, and `DevToolsActivePort` liveness probing + IDE launch-flag self-healing.

## Install or Update

- **Antigravity Custom Plugin Marketplace:** Add `https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/marketplace.json` in **Antigravity → Customizations → Plugins**.
- **One-Line PowerShell Install (Windows):**
  ```powershell
  irm https://raw.githubusercontent.com/yanhyhuan/Antigravity-Progress-Bar/main/install.ps1 | iex
  ```
- **In-App Update:** Open **Context details → `⋯` → Check for updates** inside Antigravity to update directly from `yanhyhuan/Antigravity-Progress-Bar`.
- **Standalone IDE (VSIX):** Download `antigrative-dashboard-ide-0.9.19.vsix` and select **Install from VSIX…**, then fully quit and reopen the IDE.
- **Antigravity CLI (`agy`):** Extract `antigrative-dashboard-0.9.19.zip` and run `python manage.py install-cli` (`python3` on Linux/macOS; add `--no-hook` to skip `#usage`).
