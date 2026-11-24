# Antigravity CLI status line

[English](#english) · [简体中文](#简体中文)

## English

The adapter uses the [official statusLine contract](https://antigravity.google/docs/cli/statusline/): the CLI sends JSON to stdin and displays formatted stdout. It requires **Node.js 20+**, **Python 3.10+** for installation and an Antigravity CLI supporting this interface. Windows, Linux, macOS and Android Termux share the code. It does not patch either application binary.

### Install and preview

Included in v0.6.0 and later release ZIPs. Download the package from [GitHub Releases](https://github.com/yanhyhuan/Antigravity-Progress-Bar/releases), extract it, then run the commands below from the extracted project directory.

![Real signed-in CLI conversation with cache percentage](assets/cli-conversation.png?v=0.8.4-cli-1)

Real Linux CLI 1.3.3 session with Claude Sonnet 4.6 (Thinking), captured after two English replies: context 6.8%, current-request cache share 95.7%, and 13.1K cached-read tokens. The Chinese screenshot below comes from a separate two-reply Chinese session (cache 95.4%). Images render the captured terminal ANSI output with the account email masked; conversation text and metrics are not synthetic.

Install `agy` using the [official instructions](https://antigravity.google/docs/cli/install/), then run these commands in the project directory. Linux/macOS: use `python3` instead of `python`.

```sh
node cli/statusline.mjs --preview --language en --no-color
node cli/statusline.mjs --preview-argon --language en --no-color
python manage.py install-cli
python manage.py status-cli
```

Reopen `agy`. Installation copies a standalone runtime into `~/.gemini/antigravity-cli/antigrative-dashboard/` and updates only `statusLine` in `~/.gemini/antigravity-cli/settings.json` (plus the optional `#usage` hook in `~/.gemini/config/hooks.json`). Desktop installation is not required; desktop uninstall does not remove the CLI adapter. The runtime lives in a user directory and survives CLI binary updates. Future incompatible payload/invocation changes may still require adaptation.

An independent language choice can be saved in the command:

```sh
python manage.py install-cli --language zh-CN
python manage.py install-cli --language zh-TW
python manage.py install-cli --language en
```

Without `--language`, every invocation reads the desktop plugin's persisted `AntigravityPulse/preferences.json`, falling back to English. `--node /absolute/path/to/node` overrides Node on PATH. Reinstall upgrades the code while retaining the original status line for restoration. Unrelated CLI settings are preserved. Shell invocation is tested with spaces, Chinese characters and ampersands. On Windows, when the install path has no spaces or CMD metacharacters, the installer writes small `statusline.cmd` / `hook.cmd` launchers to avoid starting PowerShell on every refresh; otherwise it uses a quote-free encoded PowerShell invocation with UTF-8 stdio and literal paths.

### Display and semantics

| Field | Source and boundary |
| --- | --- |
| Model / state | Active model label and known `agent_state` |
| Context | Explicit `used_percentage`, or complement of valid `remaining_percentage`; never cumulative input/output counters |
| Tokens | Cumulative conversation `total_input_tokens` / `total_output_tokens` (`↑` / `↓`) |
| Cache | `cache_read / (input + cache_read + cache_write)` across observed requests (or current request); falls back to raw cache-read count when input is absent |
| Speed | Estimated `≈ t/s` from observed output-token growth ÷ time spent in `thinking` / `working` (tool execution excluded) |
| Quota | Supplied bucket IDs and remaining fraction (`gemini-*`, `3p-*`, and `gemini-argon-wtu-weekly`); no guessed model family or reset schedule |
| Reset | Absolute reset time, falling back to supplied reset seconds; an elapsed reset does not force 100% balance |

Missing is `--`; zero stays zero. Explicitly disabled quota shows `Unavailable`. Context compaction can lower the percentage. The first row shows context occupancy, conversation tokens (`↑` input / `↓` output), cache hit rate, estimated speed, cost and agent state. Known Gemini, Claude/GPT and Argon weekly quota buckets each occupy a separate row, placing 5h and weekly windows together. The active model family appears first (including custom `Orchestrator` sub-planners and `Neon` codenames); unknown bucket IDs keep their supplied identity. Remaining quota numbers and bars are green at 70% or above, yellow from 30% up to (but not including) 70%, red below 30%. Red quotas also have a textual `!` so alerts survive monochrome display. Context turns amber at 60%, red at 90%, with `!` at 90%.

Normal output uses at most four lines (five when a dedicated Argon weekly bucket is also present): context row, up to two (or three with Argon) quota rows, and a turn row (`Turn` while the agent works, `Last turn` once idle). Each segment has narrower variants: as the terminal shrinks, cost and progress bars go first, then labels shorten, and truncation is the last resort; a 40-column Termux portrait screen keeps context, tokens, cache and both quota windows. Countdown text is secondary (`↻` means reset). Extra quota buckets are indicated with an ellipsis/count where room permits. The native CLI header already shows the model; the custom status line avoids repeating it, while `--details` adds one line for model, capacity and current input/output/cache creation counts. `--width 55` previews a narrow terminal.

Only foreground ANSI colors and text weights are set, allowing light/dark terminal backgrounds. `--no-color`, `NO_COLOR` and `TERM=dumb` disable colors. Automation shells commonly set the last two; a real terminal must not inherit those flags if color is wanted. No system environment variables are changed by installation. Chinese/emoji/grapheme cell widths are handled when truncating labels.

The shared `Claude/GPT` quota label uses **Claude #DA7756** and **GPT #F8FAFC** separately, with a muted slash; the supplied balance is still one shared bucket, not two independent quotas. If the terminal supplies a `COLORFGBG` light-background hint ending in palette index 7 or 15, GPT uses the terminal's default foreground instead of white. Without that hint, a light terminal can use `--no-color`. Exact RGB colors require a true-color terminal. Quota numbers and bars keep the remaining-balance thresholds.

**Speed is an estimate (`≈ t/s`):** the documented input has no streaming duration, so the adapter divides output-token growth by the time the agent spent in `thinking`/`working` between status-line samples; tool execution time is excluded. **Cache hit** = cache read ÷ (uncached input + cache read + cache write) per completed request, following the official example where `input_tokens` and `cache_read_input_tokens` are listed separately.

### Argon weekly quota

The adapter recognizes the exact `quota["gemini-argon-wtu-weekly"]` key as **Argon week**. Only a returned bucket creates the row; an Argon model name or Pro plan label alone never creates a quota or a five-hour window. When the active model is Argon and the dedicated bucket is present, its weekly row appears first (and up to three known quota rows stay visible). Unknown Argon-looking keys keep their original identity.

### Usage details: type `#usage`

Inside `agy`, send `#usage` (also `#u`, `#用量`, `##`; the full-width `＃` works too). A `PreInvocation` hook registered in `~/.gemini/config/hooks.json` answers locally and stops before the model is called, so it costs no request or quota. Only a prompt that is exactly a trigger is intercepted; `#usage of fetch()` reaches the model as usual. The hook ignores desktop App conversations even though that file is shared. Outside `agy`, `python manage.py usage-cli [--watch]` or `node cli/usage.mjs` prints the same report.

The report shows conversation tokens, cache hit, estimated speed, cost, context, the last turn, today / 7-day / 30-day totals, a 14-day sparkline, models over 7 days and the latest quota snapshot. Install with `--no-hook` to skip the hook.

### Local statistics

The status line keeps a small ledger in `~/.gemini/antigravity-cli/antigrative-dashboard-data/conversations/<hash>.json` (`AG_PULSE_CLI_DATA` overrides it; `--no-ledger` or `AG_PULSE_CLI_NO_LEDGER=1` disables it). Files are keyed by a one-way hash of the conversation ID and contain only numbers, model labels and state: no prompts, titles, IDs, paths, e-mail or transcript data. Totals that already existed when a conversation is first seen (for example after `/resume`) are kept as a baseline and never attributed to a day. Uninstall keeps the statistics. No network or background polling is used. Resumed statistics depend on the current CLI payload; missing data cannot recover from another conversation, model, account or the desktop history store. `--json` outputs normalized display fields only, excluding email, workspace, session IDs and transcript paths. `--preview` / `--preview-argon` use synthetic data and write nothing.

### Termux, failures and diagnostics

Termux's Node reports `android`; it now uses Linux/XDG paths instead of failing. A malformed payload prints `Antigrative Dashboard: --` with exit code 0, so `agy` never hits its "disabled after 30 consecutive failures" guard. `node cli/statusline.mjs --doctor` checks Node, platform, paths, storage and rendering; `AG_PULSE_CLI_DEBUG=1` prints the failing stage name (never payload text) to stderr. On Windows, when the install path has no spaces or CMD metacharacters, the installer writes small `statusline.cmd` / `hook.cmd` launchers instead of starting PowerShell on every refresh; otherwise it keeps the encoded PowerShell transport.

**Hollow boxes instead of symbols:** the legacy Windows console host (the blue/black "Windows PowerShell" window, not Windows Terminal) lacks glyphs for some symbols such as `↻`, and may draw `░` or `●` as boxes. A Windows session with none of `WT_SESSION`, `TERM_PROGRAM`, `ConEmuANSI` or `TERM` set therefore uses ASCII symbols automatically (`#` / `-` bars, `^` `v` arrows, `~` for estimates and resets, `|` separators) with unchanged widths; the `#usage` report follows the same rule. Force a mode with `--ascii` / `--unicode` or `AG_PULSE_CLI_GLYPHS=ascii|unicode`; `--doctor` shows the active mode. Running `agy` in Windows Terminal with a font such as Cascadia Mono also avoids the problem.

`node tools/preview-cli.mjs` writes `dist/cli-preview.html`, a browser preview rendered by the real code with synthetic data (widths 28–140, dark/light, Unicode/ASCII symbols, both languages, and the `#usage` report).

### Disable and restore

Inside `agy`, `/statusline off` suspends rendering and `/statusline on` resumes it. See the [official command reference](https://antigravity.google/docs/cli/commands/statusline).

```sh
python manage.py uninstall-cli
```

The prior statusLine is backed up at `~/.gemini/antigravity-cli/.antigrative-dashboard-install.json`. Uninstall restores it only while our command is still selected; a replacement configured later is preserved. Our runtime, registered `#usage` hook (if still owned by us) and recovery record are removed, while unrelated CLI settings, other hooks, desktop data and local usage statistics remain. Unknown destinations, symlinks/junctions and invalid recovery records block destructive changes. A lifecycle lock blocks overlapping installation/removal; after a crash, inspect the named lock before manually removing it.

### Verification scope

Automated checks cover official example values, zero/missing/disabled values, Argon weekly quota isolation, ledger delta/turn tracking, `#usage` hook interception, ASCII symbol fallback, Termux `android` path mapping, compaction/model isolation, CJK/emoji widths, input limits, ANSI, quota color boundaries, `en`/`zh-CN`/`zh-TW` across processes, real shell/CMD shim invocation, failed upgrades and configuration restoration.

## 简体中文

![真实中文 CLI 两轮对话及当前请求缓存率](assets/cli-conversation-zh.png?v=0.8.4-cli-1)

从 [GitHub Releases](https://github.com/yanhyhuan/Antigravity-Progress-Bar/releases) 下载最新安装包，解压后在项目目录运行以下命令。上图是 Linux CLI 1.3.3 使用 Claude Sonnet 4.6 (Thinking) 的真实中文两轮对话，账号已遮挡。

通过 [Antigravity CLI 官方状态栏接口](https://antigravity.google/docs/cli/statusline/) 接入，要求 **Node.js 20+、Python 3.10+** 和支持该接口的 `agy`。Windows/Linux/macOS/Android Termux 共用实现；Linux/macOS 把以下 `python` 换为 `python3`。

```sh
# 示例数据预览，不写入统计
node cli/statusline.mjs --preview --language zh-CN --no-color
node cli/statusline.mjs --preview --language zh-TW --no-color
node cli/statusline.mjs --preview-argon --language zh-CN --no-color
# 默认跟随桌面版保存的语言
python manage.py install-cli
# 或单独固定语言
python manage.py install-cli --language zh-CN
python manage.py install-cli --language zh-TW
python manage.py status-cli
```

重新打开 `agy` 后，第一行显示上下文占用、会话 Token（`↑` 输入 / `↓` 输出）、缓存命中率、估算速率、花费和状态；最后一行在生成时显示“本轮”，空闲时显示“上轮”小结。Gemini、Claude/GPT 额度各一行，同行排列 5h 与周额度；接口返回独立 Argon 周额度（`gemini-argon-wtu-weekly`）时另占一行，当前模型所属组（含自定义 `Orchestrator` 子规划器与 `Neon` 模型）优先展示。额度数字与进度条统一按剩余量变色：≥70% 绿色、30%≤剩余<70% 黄色、<30% 红色；红色额度附 `!`。上下文不低于 60% 变黄、不低于 90% 变红并附 `!`。进度条辅助扫读，`↻` 表示重置倒计时，作为次要文字显示。

窗口变窄时先去掉花费和进度条，再缩短标签，最后才截断；默认至多四行（有独立 Argon 周额度时至多五行），Termux 竖屏 40 列仍保留上下文、Token、缓存和两个额度窗口。模型名称由宿主顶部提供，插件不重复占一行。`--details` 增加模型、容量和当前输入/输出/缓存写入量；`--width 55` 预览窄窗口。只设置前景色和字重，兼容深浅终端背景；`--no-color`、`NO_COLOR` 或 `TERM=dumb` 可关闭颜色。自动化运行环境可能自带这些标志；想看到彩色时，启动 CLI 的真实终端应避免继承这些标志。安装不会修改系统环境变量。

共享额度标签分别使用 **Claude #DA7756** 与 **GPT #F8FAFC 雪白色**，斜线弱化显示；仍展示官方提供的同一组共享额度，不拆成两份。终端的 `COLORFGBG` 浅色背景标志末尾为 7 或 15 时，GPT 回退为终端默认前景色，避免白字难读；没有提供该标志的浅色终端可用 `--no-color`。精确 RGB 颜色需要真彩色终端支持。额度数字和条形继续按剩余量绿、黄、红分档。

配置在 `~/.gemini/antigravity-cli/settings.json` 的 `statusLine`；运行文件在 `~/.gemini/antigravity-cli/antigrative-dashboard/`；恢复记录是同级 `.antigrative-dashboard-install.json`。不改桌面配置或 App 归档；CLI 二进制更新不会覆盖用户目录中的适配器，未来接口变更仍可能需要更新。

**速率是估算值（`≈ t/s`）**：官方输入没有流式耗时，插件用输出 Token 的增量除以状态为思考/生成的时间，不含工具执行时间。**缓存命中** = 缓存读取 ÷（未缓存输入 + 缓存读取 + 缓存写入），按已完成请求统计。上下文使用明确占用比例；缺失显示 `--`，零值显示零，显式禁用显示「不可用」，额度到期不会自行变成 100%。

**用量详情：在 agy 里输入 `#usage`**（或 `#u`、`#用量`、`##`，全角 `＃` 同样有效）。安装器在 `~/.gemini/config/hooks.json` 注册一个 `PreInvocation` hook，在调用模型前本地响应并终止，不消耗请求和额度。只拦截整条输入完全等于触发词的情况，“#usage 这个函数”照常发给模型；桌面 App 共用该文件，但 hook 会忽略 App 对话。agy 外可用 `python manage.py usage-cli [--watch]` 或 `node cli/usage.mjs`。安装时加 `--no-hook` 可不注册。

**本地统计**保存在 `~/.gemini/antigravity-cli/antigrative-dashboard-data/`（`AG_PULSE_CLI_DATA` 可覆盖，`--no-ledger` 或 `AG_PULSE_CLI_NO_LEDGER=1` 可关闭）。文件名是会话 ID 的单向哈希，只存数值、模型名和状态，不存正文、标题、ID、路径、邮箱或 transcript；会话首次出现时已有的累计值（如 `/resume`）只作基线，不计入任何一天。卸载保留统计，不联网、不后台轮询。

**Termux 与故障排查**：Termux 的 Node 报告 `android`，现按 Linux/XDG 路径处理，不再报错。输入异常时输出 `Antigrative Dashboard: --` 并以 0 退出，避免触发 agy “连续失败 30 次停用”。`node cli/statusline.mjs --doctor` 检查 Node、平台、路径、存储和渲染；`AG_PULSE_CLI_DEBUG=1` 在 stderr 只输出失败阶段名。Windows 安装路径不含空格和 CMD 特殊字符时，改用 `statusline.cmd` / `hook.cmd` 小启动器，省掉每次刷新启动 PowerShell 的开销。`node tools/preview-cli.mjs` 生成浏览器预览 `dist/cli-preview.html`。

**显示成空心方框？** 旧版 Windows 控制台（黑底的“Windows PowerShell”窗口，不是 Windows Terminal）的字体缺少 `↻` 等符号，`░`、`●` 也可能显示成方框。在 Windows 上没有 `WT_SESSION`、`TERM_PROGRAM`、`ConEmuANSI`、`TERM` 任一环境变量时自动改用 ASCII 符号（`#`/`-` 进度条、`^` `v` 箭头、`~` 表示估算和重置、`|` 分隔），宽度不变，`#usage` 报告同样适用。`--ascii` / `--unicode` 或环境变量 `AG_PULSE_CLI_GLYPHS=ascii|unicode` 可手动指定，`--doctor` 会显示当前模式。改用 Windows Terminal + Cascadia Mono 等字体也能避免。

未指定语言时读取桌面版持久化选择，明确指定 `--language` 则独立固定。CLI 内 `/statusline off` / `/statusline on` 可停用/启用。卸载并恢复之前的状态栏：

```sh
python manage.py uninstall-cli
```

如果后来已换用其他状态栏，会保留新的选择。独立安装、更新或卸载不依赖桌面应用，不启停桌面插件。自动测试覆盖异常输入、中文（简/繁）/窄窗口、Argon 周额度、本地账本、`#usage` hook、ASCII 符号回退、Termux 路径、语言跨进程、带空格路径与 `.cmd` 启动器执行、失败升级恢复和卸载还原。
