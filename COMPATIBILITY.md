# 兼容性与验证范围

| 系统 | 安装 / 后台发现 | 验证范围 |
| --- | --- | --- |
| Windows | Python / PowerShell，CIM 筛选 standalone + 单次 netstat PID 所属监听端口 | Windows 11 / 桌面 App 2.21.1、2.22.0；真实对话上下文、合并悬浮卡已实机验证并验收；CI 生命周期与数据测试 |
| Linux | Python3 / POSIX shell，当前用户 `/proc` + TCP/TCP6 socket inode | Ubuntu CI 原生端口测试、安装生命周期、官方 2.21.1 资源与 SDK 检查；完整登录 App GUI 待用户实机验证 |
| macOS | Python3 / POSIX shell，当前用户 `ps` + `lsof` PID 所属端口 | macOS CI 原生端口测试、安装生命周期、官方 2.21.1 资源与 SDK 检查；完整登录 App GUI 待用户实机验证 |

上表面向 **Antigravity 桌面 App 2.21.1 / 2.22.0**。CLI 使用独立 statusLine 适配；v0.7.0 新增自带 IDE 的独立 VSIX。VS Code、Visual Studio、JetBrains、Zed、Xcode 中的 Antigravity 扩展以及 iOS 尚未兼容。表中保留早期桌面 App 2.21.1 的资源验证记录；v0.8.13 的资源检查目标更新为 2.28.2，仍不等同于 IDE 或登录后 GUI 验收。
Python 3.10+ 仅用于生命周期，无 pip 依赖；后台使用宿主 Node，内嵌桥接需原生 WebSocket，建议 Node 24。Linux/macOS 架构跟随宿主，不分发平台二进制。官方系统要求见 [Antigravity 下载页](https://antigravity.google/download)。

2026-10-28 补充：Windows 11 / 桌面 App **2.28.0** 已实机验证修复后的单份控件、历史会话速率／Token／上下文恢复、详情卡、用量窗口、额度和会话往返切换。延迟回调与重复挂载的浏览器回归纳入三系统 CI；这不等同于 Linux/macOS 2.28.0 或新版独立 IDE 的登录后实机验收。安装后需要完整退出并重开宿主一次。

2026-10-29 / **v0.8.12**：App 与独立 IDE 共用有限历史队列、显式 `usageSync` 门控、同步所有权缓存及异步边界复核。普通轮询、普通卡片刷新和额度重置不启动历史补录；打开「查看用量统计」或点击其右上角「刷新用量」才发起导入。失权后的排队写入在提交前取消；队列／检查点超出预算或记录不可读取时，保留已有统计并报告部分覆盖。

本次本地验证：Node 334 项通过、1 项跳过；Python 81 项通过、1 项跳过（共 82 项）；IDE 11 项通过，相关浏览器回归通过。新版三系统发布 CI 会在发布流程中分别执行，不能将这些本地／浏览器结果视作 Linux/macOS 登录后原生 GUI 已验收。

2026-10-30 / App **2.28.2** 排查：官方发行列表确认版本与构建号；对官方 Linux 发行包只读检查，SDK 能提取并加载，Electron 默认调试端口和主要输入框标记仍存在。Windows 本机 2.28.2 的现有控件可见速率、缓存与上下文，使用仓库 v0.8.12 采集代码只读取得相应统计。实机已安装插件清单仍为 v0.8.9，因此不能据此宣称完整的 v0.8.12 安装、所有平台和所有用户环境均已验收。尚未复现反馈者的「完全不生效」场景，需要区分控件缺失与数据未连接，并核对实际加载版本、宿主类型及集成状态。官方资源 CI 配置改查 2.28.2，历史 2.21.1 的验证记录保留。

2026-10-30 / **v0.8.13**：修复 Windows 用户目录 Junction 导致的在线更新失败，支持逻辑路径与物理路径并保留运行时路径校验；补充旧数据布局的备份隔离、过期计划重查及三语言错误分类。本地 Node 340 项通过、1 项跳过；Python 93 项通过、1 项跳过（共 94 项）；三语言更新 UI 和三种真实进程升级场景通过。三系统完整回归及官方 2.28.2 资源检查作为发布前门禁。

2026-10-30 / **v0.8.14**：修复 App 侧栏子代理误取主会话统计，按官方 2.28.2 的消息区／输入框兄弟结构识别局部会话；未知身份保持为空，仅内联请求禁止自动选择最近会话。Node 346 项通过、1 项跳过；中英文侧栏、Full View、原有 Teamwork、子代理、生命周期及 IDE 浏览器回归通过。新场景为使用生产控件的合成 DOM 验证，不等于反馈者原始会话或各系统登录后的实机验收。

2026-10-30 / **v0.8.15**：超长会话可使用资源受控的后台任务补全，完成前保留上次完整数据；无法继续时显示原因。此路径需要可用的 `node:sqlite`（Node 22.13+ 或等效宿主），推荐 Node 24；不支持时维持原保护。Windows 的合成真实进程实验不等同于反馈者原始会话或 Linux/macOS 登录后的实机验收；子代理覆盖未完成时标记为部分。详见 [超长会话限制与验证](docs/LONG_CONVERSATIONS.md)。

2026-10-31 / **Issue #26 本地修复**：Antigravity IDE 2.6.0 的后台从 `language_server_* --subclient_type ide` 迁移到严格的 `agy --hub` 形式。进程发现现在同时支持两种形式，并限制在拥有当前 renderer 调试端口的 IDE 根进程的有界进程链内。renderer 的 CDP 挂载不再等待指标服务发现；指标服务暂不可用时，控件仍可挂载并返回离线状态。新增 Windows/POSIX、普通 `agy`、LSP、多实例、helper lineage 和挂载失败回归。当时的后台进程发现修复尚未覆盖 2.6.0 的 Webview 挂载；该问题在 v0.8.20 中处理。

## Antigravity 自带 IDE

2026-11-27 / **v0.9.20** 合入上游 #26 和 #28。周额度按当前账号的额度周期估算，遇到周期中途重置时优先使用重置后的样本。总览与内联栏显示相同的满额 Token 数，双币成本看板沿用原有汇率。macOS 独立 IDE 2.8.0+ 支持路径含空格的 `Antigravity IDE.app` 以及包内名为 `Electron` 的主进程。进程识别由模拟 macOS 进程列表的测试覆盖。

2026-11-26 / **v0.9.19（3D 奶龙输入框上方操作按钮自动避让与横向自由拖动换位）**：针对排队消息卡片（Queued Message 右侧编辑 `✏️` / 删除 `🗑️` 按钮）、待确认操作条及 `/btw` 顶栏等挂载在输入框上方同属底部栏（Composer Dock）的交互按钮，新增非滚动底部栏障碍扫描与迟滞自动横向让位（优先平移至按钮左侧无遮挡区间，全宽占满时自动收起隐藏，队列清空后自动归位；普通聊天滚动区内的消息按钮仍严格豁免防闪烁）；同时新增鼠标按住奶龙沿输入框顶边**左右自由拖动换站位**（自动持久化记忆至 `localStorage`，巡逻散步方向随当前左右余量自动切换）。

2026-11-26 / **v0.9.18（同步上游 v0.9.17–v0.9.18 Remote-SSH 窗口路由与独立 IDE 启动自愈）**：
- **桌面端 App `(SSH: <host>)` 窗口与独立 IDE Remote-SSH 支持**：新增零依赖本地回环 SOCKS5 客户端（`sidecars/panel/socks5.mjs`）与本机 `ssh -D` 隧道及远端探测模块（`sidecars/panel/ssh-remote.mjs`），通过 `ssh -T ... -- <destination> sh -s` 经 `stdin` 管道执行无通配符 POSIX `sh` 探测（`BatchMode=yes`，排除探测自身 PID 并按整行锚定解析 `===AGP_PS===` / `===AGP_DAEMON===` / `===AGP_LOGS===`，兼容远端 `zsh`/`bash`/`fish`/`csh` 默认登录 shell 与登录横幅）；在 `sidecars/panel/main.mjs` 与 `ide/main.mjs` 隔离本地/远程窗口上下文（`localContext` / `remoteContexts`，禁用远端窗口的本地磁盘扫描，共享本机 `UsageLedger` 与双币种 `PricingService`）；独立 IDE 同步支持校验 `vscode-remote+ssh-002dremote-002b...` Webview 与远端 `.antigravity-ide-server` 凭据配对（`ide/webview-targets.mjs`、`ide/remote-client.mjs`）。
- **独立 IDE `DevToolsActivePort` 探活与跨平台启动参数自愈**：在 `compat/launch-config.mjs`、`ide/launch-self-heal.mjs`、`ide/extension.cjs` 中新增回环调试端口 TCP 探活与 Windows `.lnk` / Linux `.desktop` / macOS 启动器参数检测修复（`antigrativeDashboard.ide.autoConfigureLaunch` 及 `Repair IDE Launch Flags` 命令），解决 IDE 自动升级清空启动参数后残留旧端口文件导致静默重连的问题；完整保留 3D 奶龙、彩色双币种 24h 看板、`Antigravity 2.35.0` 模型映射与 Windows 任务完成通知。

2026-11-25 / **v0.9.16（同步上游 v0.9.11–v0.9.16+ 并完整保留本仓增强特性）**：
- **连接发现、抗 403 误拉黑与远程 SSH/WSL Hub 适配**：新增 Antigravity `2.34.0+` 守护进程发现文件（`~/.gemini/antigravity/daemon/{ls,hub}_*.json`，防符号链接并校验同 UID 与 PID/端口归属）与无头远程 SSH/WSL Hub 识别（远程环境不误写本地启动快捷方式，侧边面板给出明确提示并保持统计正常），同时保留本机 HTTPS loopback Connect-RPC 兜底；已验证健康的 sidecar 端点遇到单接口 HTTP `403` 时标记为 `RPC_RESTRICTED`（不清空端点或拉黑凭据，补充英/简/繁三语提示）并自动回退至 `TranscriptReader.readMetrics` 流式统计 `2.34.0` `transcript.jsonl` Token；`compat/runtime-ui.mjs` 与 `compat/inline-widget.cjs` 在桥接 15s 超时、队列满（`inflight >= 8`）或单次 5s CDP 心跳超时时保持状态条常驻不消失，冷启动未水合阶段显示「连接 Antigravity… / 读取额度…」。
- **持久化增量 SQLite 用量索引（含 120 天 24 小时分时桶）与防 OOM 保护**：引入 `.usage-index-v1.sqlite`（`SCHEMA_VERSION = '2-hours-v1'`）替代全量内存聚合，原生存储、时区重算并输出本仓专属的 **120 天 24 小时逐时桶**（`day.hours[0..23]`、`hoursFrom`、`1.5 MiB` 预算裁剪）；主线程 `maxWaitMs: 350` 与 `busy_timeout: 250ms` 防阻塞，多文件（`> 16`）汇总与脏文件自动下放后台 worker，为 `MetricsStore.sessions`（上限 32）与 `TrajectoryReader`（8 MiB / 4 项）补齐优先保护运行中 `RUNNING` 会话的 LRU 淘汰及 128 MiB 堆水位反压，并移除 `sidecar.json` / `ide/extension.cjs` 的 `--max-old-space-size=192` 硬崩溃上限。
- **混合额度满额估算（USD 成本空间校准）、极简折叠状态条与彩色双币种看板增强**：新增 `QuotaEstimator` 与桌面/IDE 共用的 `compat/pricing.cjs`，在官方 API 美元成本空间同步估算 5h/周满额容量（`observedCostUsd` / `estimatedFullUsd`）并在概览新增第 5 张「预测周额度」（`≈$...USD` / 人民币折算）卡片，修正跨厂商 `Orchestrator <自定义模型>`（如 `Orchestrator Claude Opus ...` 归入 `3p`）的额度池路由；支持状态条一键切换「完整栏 / 极简栏（`< ○ 47%`，最窄 24px）」并与 **3D 奶龙** 悬浮卡避让联动；在**完整保留本仓彩色堆叠柱状图、24 小时视图、OpenRouter 人民币 `¥` / 美元 `$` 实时汇率计费、组件过滤、`Alt+Click` 独显、`<0.1%` 折叠与柱体下钻**的基础上，融合同模型思考档位与 Orchestrator 代号自动合并（多档位行悬停显示档位占比明细）及 `K/M/B/T` 紧凑表格单位（未采用上游 v0.9.8 删宠或 v0.9.15 单色冰山图改版）。
- **Windows 快捷方式全语系兼容、独立 IDE VSIX 修复与 `agy` CLI 全面升级**：Windows 启动入口发现兼容 Known Folder 重定向桌面/开始菜单与 `OneDrive*\Desktop`，PowerShell stdin 采用纯 ASCII `\uXXXX` 转义并通过 ASCII 临时文件写入 `.lnk` 快捷方式以兼容全部系统区域设置；修复独立 IDE VSIX 遗漏 `compat/host-theme.mjs` 启动退出的问题（一并打包 `compat/pricing.cjs`、`usage-index.mjs`、`quota-estimator.mjs`、`pricing.mjs`，并在 `tests/test_ide.py` 增加全量相对导入扫描与 Node ESM 实机加载门禁）；保留 **Windows 任务完成通知钩子**（`hooks/`、`sounds/`、`notify-settings.json`）；全面升级 `agy` CLI 状态栏（响应式会话 Token、缓存率、估算 `≈ t/s`、花费、`本轮/上轮` 小结、单向哈希本地账本、`#usage`/`#用量` 零额度本地 hook、`manage.py usage-cli`、Termux `android` 兼容、旧版控制台自动 ASCII 回退、`.cmd` 轻量启动器与 `--doctor`）。

2026-11-21 / **v0.9.11（Antigravity Desktop 2.34.0 适配与上游 v0.9.8–v0.9.10 同步）**：
- **适配 Antigravity Desktop 2.34.0 本地凭据与端口变更**：从 `2.34.0` 起，`language_server` 不再通过命令行参数传递 `--csrf_token`，改为通过环境变量注入，并调整本地日志监听文案为 `listening on loopback port at <N> for local HTTP (SDK/gRPC)` 与 `listening on random port at <N> for HTTPS (gRPC)`。现优先读取宿主 Sidecar SDK 官方注入的 `ANTIGRAVITY_LS_ADDRESS` 与 `ANTIGRAVITY_CSRF_TOKEN`（严格限制 loopback 地址 `127.0.0.1` / `localhost` / `::1` 与有效端口），并在 `401` / `403` 或独立运行模式下自动回退至兼容新旧日志文案的本机进程发现。
- **适配 2.34.0 Orchestrator 自定义规划模型与思考档位**：新增对 `Orchestrator <自定义模型>`（如 `Orchestrator Claude Opus 5.5 (Max)` 归入 `Claude / GPT` 额度桶、普通 `Orchestrator` 归入 `Gemini` 额度桶）及 `(XHigh)` / `(Max)` / `(Orchestrator)` 档位后缀的额度分组、成本估算和上下文容量识别支持。
- **同步上游 v0.9.8–v0.9.10 增强并完整保留本仓增强特性**：新增会话上下文压缩次数徽章（`🗜 N 次`）与 `75%` 预警环色、合并去重额度错误提示 `#quota-error`、全语种脱敏拦截 PowerShell/进程命令原始报错、免 PowerShell 空闲连接续期、以及 Windows `AntigravityLauncher.exe` 代理快捷方式识别；同时完整保留 **3D 奶龙视频图集交互挂件**、**人民币 `¥` / 美元 `$` 成本估算**、**24 小时用量柱状图**与 **Windows 任务完成通知钩子**。官方资源 CI 更新至 `2.34.0-5887025308631040`，Windows 11 本机 **Antigravity Desktop 2.34.0** 资源与内置 SDK 校验通过。

2026-11-01 / **v0.8.17（Issue #27）**：Windows App 与 IDE 共用本机端口发现，排除 TUN 产生的伪监听行；备用查询兼容报告中的 `State: 0`，同时验证 PID、环回／通配地址、未连接远端及有效端口，拒绝 `Bound`、`Closed` 等状态。HTTP 日志与 renderer 端口只作为补查提示，不能代替进程归属证明；最新端口缺失时，不再被其他监听端口或复用的旧端口掩盖。正常路径保留 netstat，异常路径一次批量 PowerShell 查询，沿用超时、输出上限及客户端退避。本地合成回归与真实 Windows netstat／CIM 检查通过，已安装代码成功发现 App 接口并取得 `GetUserStatus` 响应；宿主停在登录引导页，未完成登录后控件验收。报告者的 TUN `State: 0` 原始环境仍需其复测。

2026-11-19 / **v0.9.7（Neon 彩蛋版）**：在 `compat/inline-widget.cjs` 新增 **Neon（氖龙）毛绒玩偶交互彩蛋**：切换到含 Neon 的模型时，通过独立 Shadow DOM 裁剪舞台在会话栏外框右上角弹出内联双帧毛绒 WebP（约 `10.8 KB`，零外链、零宿主样式侵入），支持定制 `✦ 氖龙` 微磨砂气泡、按住摸头揉捏与阻尼果冻回弹、单击切换「缩回偷看 / 坐出来」（`localStorage` 持久化）、近场歪头、打字节奏陪伴及深色霓虹紫轮廓光；碰撞避让仅针对真实浮动/固定控件（忽略滚动消息区内的普通链接与按钮），并在窄窗、子代理及用量弹窗打开时自动安全隐藏。

2026-11-19 / **v0.9.6**：完善 **macOS Antigravity Desktop 2.33.0+** 启动与恢复体验：`manage.py install` 与运行中 sidecar 自动创建并自愈用户自有启动器 `~/Applications/Antigravity (Dashboard).app`（保留 `/Applications/Antigravity.app` 原签名与公证、复制图标、设置 `LSUIElement`，且在旧进程未开调试端口时弹窗支持一键退出重开）；`manage.py launch` 新增运行中实例检测、`--restart` 优雅重开、优先通过 `/usr/bin/open -a` 启动、自动复用已保存的 `appResources`/`profile`，并提供已安装目录兜底命令 `compat/launch_config.py launch`。

2026-11-18 / **v0.9.5**：优化数百个历史会话环境下的内存与宿主负载：历史 Token 用量补录（`DesktopUsage` / `TrajectoryReader.readUsage`）改走仅元数据轻量通道（`GetCascadeTrajectoryGeneratorMetadata({ includeMessages: false })`），不再全量反序列化 `GetCascadeTrajectorySteps(verbosity: 3)` 或挤占前台 8 MiB 缓存（仅在缺失 `chatStartMetadata.createdAt` 时按 `[minStep..maxStep]` 懒读必要步骤），过滤未入列的孤儿 `brain/<id>` 目录并将已稳定（`>= 60s`）的 0 请求 `.db` 标为 `complete`，配合分片流控（`1500ms` 预算、单片最多 `8` 个、单条间隔 `80ms`、片间 `1200ms`）与同步期 `UsageLedger.summary()` 扫描节流；日常待机共享 `GetAllCascadeTrajectories` 摘要缓存并放宽稳态 TTL（`12s–15s`），健康 HTTP 200 连接续期免去 `15s` 全量进程/日志扫描，日志发现改用 `256 KiB` 尾部逆向分块（`readLogTail`），内置 SDK 提取改用 `2 MiB` 滑动窗口分块（`extractBundledSdkFromFile`），并为 App/IDE 采集器主进程配置 `--max-old-space-size=192`。本地验证：Node 494/495 通过（1 skip）、IDE 67/67 通过、Python 102/102 通过（1 skip）。

2026-11-18 / **v0.9.4（含 v0.9.2–v0.9.3）**：适配 **Antigravity Desktop 2.33.0+**。从 `2.33.0` 起，桌面宿主默认不再开启 `--remote-debugging-port`，未传该参数时会调用 `removeStaleActivePortFile` 删除 `DevToolsActivePort`。为在不修改 `resources/app.asar`、保留签名与跨更新稳定性的前提下恢复内嵌状态条：
- `manage.py install` 与运行中 sidecar 会自动为用户自有启动入口配置 `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1`（Windows `.lnk` 快捷方式、Linux `~/.local/share/applications/antigravity.desktop`、macOS 用户自有轻量启动器 `~/Applications/Antigravity (Dashboard).app`，不触碰原版 `/Applications/Antigravity.app` 签名），并在宿主自动升级或插件在线更新后自动自愈；`manage.py uninstall` 与 `--panel-only` 仅撤回插件受管的启动参数、`.desktop` 覆盖文件或启动器 `.app`。
- 提供 `python[3] manage.py launch`（支持 `--exe` / `--workspace` / `--app-path` / `--restart`），自动复用已保存的 `appResources` 与 `profile`；macOS 上会检测是否已有未开调试端口的运行中实例（避免未先 `⌘Q` 导致无感失效），支持 `--restart` 优雅退出并重开，且优先使用 `/usr/bin/open -a` 通过 LaunchServices 启动。即使删除源码目录，也可运行 `~/.gemini/config/plugins/antigravity-pulse/compat/launch_config.py launch`。
- `manage.py status`、`integration-state.json` 与侧边面板同步报告 `hostVersion`、`hostRequiresDebugFlag`、`launchConfiguration` 及 `reason: "debug-port-disabled"` 诊断。已在 Windows 11 本机 **Antigravity Desktop 2.33.0** 实机验证挂载与连接；社区用户实测确认 macOS **2.33.0** 带参数启动后 `DevToolsActivePort` 连接与 `#ag-pulse-status-bar` 挂载正常（完整交互 GUI 验收仍待继续补充）。

2026-11-17 / **v0.9.1**：项目维护与 App 更新源迁移至 `ATtacK030130/antigrative-dashboard`（保留原有 IDE 扩展标识 `you-should-know-me.antigrative-dashboard-ide` 与本地数据目录）。新增像素猫 / 简约速度卡样式切换、额度消耗速率状态与重置前余量线性预测、当前额度周期实测用量参考、Token 用量「本机全部 / 当前账号」范围切换、以及跟随宿主 Appearance 字体的 `--pulse-font` / `--pulse-font-mono` 同步。已在 Windows 11 本机 **Antigravity Desktop 2.32.2** 通过宿主资源/SDK 检查与插件挂载（`v0.9.1`），并完成 Node 482/483（1 skip）、IDE 67/67、Python 95/95（1 skip）及 Edge CDP 端到端浏览器测试。

专用包为 `antigrative-dashboard-ide-0.9.20.vsix`，安装入口与桌面 App 独立。
Windows 11 / IDE 2.5.5（VS Code base 1.107.0）已用真实对话验证速率、缓存、上下文、重启历史恢复和窄宽布局。IDE 2.6.0 的控件挂载和真实对话数据已由用户验收；Linux/macOS 的登录后 IDE 界面仍待实机验证。
Linux/macOS 的 IDE 进程筛选、端口归属、安装打包和 Trusted Types 浏览器 fixture 纳入 CI；登录后的 IDE GUI 仍待实机验收。
当前仅支持默认用户 profile；私有 Preact/DOM 或 RPC 变化可能需要适配，不能保证未来 IDE 版本无需维护。
插件需通过 loopback renderer 端口挂载：完整退出后带 `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1` 参数启动。普通启动不会自动打开此端口。
不修改应用归档或 CSP，扩展启动／停止后台，并按 profile 协调多窗口所有权。用户数据保存在 IDE 自己的 extension global storage，与桌面 App 的历史和语言设置独立。
完整安装、升级、数据清理与撤回流程见 [ide/README.md](ide/README.md)。

## 安装与自定义位置

Windows：`python manage.py install` / `./install.ps1`。
Linux/macOS：`python3 manage.py install` / `sh install.sh`。
启停、状态、卸载同样使用 `python3 manage.py <action>`，或 `sh uninstall.sh`。不要使用 sudo，否则会安装到错误用户目录。

默认查找 Windows 用户安装目录、macOS `/Applications/Antigravity.app` 与 `~/Applications/Antigravity.app`、Linux `/opt/Antigravity`、`/opt/antigravity`、`/usr/share/antigravity`，以及 PATH 中启动器所在目录。
自定义安装：`python3 manage.py install --app-path '/path/to/resources/app.asar'`；安装器记住资源位置供 SDK 发现。
`AG_PULSE_APP_ASAR` 可覆盖生命周期检测位置；`AG_PULSE_PROFILE` 可在安装时指定用户配置目录并保存。
如果宿主省略 SDK 解析与语言服务器路径，可用 `ANTIGRAVITY_AGENTAPI_EXE` 指定其已安装的语言服务器，或 `AG_PULSE_APP_RESOURCES` 指定资源目录。环境变量应传给启动 App 的环境。

语言服务日志：Windows/Linux 默认读取 `<profile>/logs/language_server.log`；macOS 优先读取 `~/Library/Logs/Antigravity/language_server.log`，缺失或不能匹配当前 PID 端口时回退到 profile 日志。`AG_PULSE_LOG` 可显式指定唯一日志位置。回退仍校验当前进程拥有该 HTTP 端口，不连接旧日志中的失效接口。

## 独立用户数据目录

| 内容 | Windows | Linux | macOS |
| --- | --- | --- | --- |
| App profile | `%APPDATA%/Antigravity` | `${XDG_CONFIG_HOME:-~/.config}/Antigravity` | `~/Library/Application Support/Antigravity` |
| 插件设置 | `%LOCALAPPDATA%/AntigravityPulse/settings.json` | `${XDG_DATA_HOME:-~/.local/share}/AntigravityPulse/settings.json` | `~/Library/Application Support/AntigravityPulse/settings.json` |
| 语言选择 | `%LOCALAPPDATA%/AntigravityPulse/preferences.json` | `${XDG_DATA_HOME:-~/.local/share}/AntigravityPulse/preferences.json` | `~/Library/Application Support/AntigravityPulse/preferences.json` |
| 备份 | `%LOCALAPPDATA%/AntigravityPulseBackups` | `${XDG_DATA_HOME:-~/.local/share}/AntigravityPulseBackups` | `~/Library/Application Support/AntigravityPulseBackups` |

三系统插件均在 `~/.gemini/config/plugins/antigravity-pulse`；历史均在 `~/.gemini/antigravity/sidecar_data/antigravity-pulse/panel/data/history-v1/<account-hash>/<conversation-id>.json`（宿主可覆盖 data 目录）。
更新、重装、卸载保留统计数据，不保留已卸载的运行代码。设置开关保留其他插件和自定义字段。

## 上下文数值的含义

最近一次 chat model 的 `chatStartMetadata.contextWindowMetadata` 中，`estimatedTokensUsed` 是宿主估计，`maxContextTokens` 是该请求容量。已用 = used/max，剩余不小于零。
这是请求开始时的采样，非会话累计 Token，非实时流式计数。悬停卡明确注明来源、采样模型和历史恢复时间。没有容量就不显示百分比，不通过模型名称猜容量；新模型没有元数据就不沿用旧模型窗口。超过容量的估计显示真实比例并提示，进度环最大填满。压缩后允许下降。

## 更新与失败恢复

默认安装不修改 `resources/app.asar`，由用户插件中的运行时适配器通过宿主现有 loopback 调试通道挂载。每 3 秒重试端口变化、文档替换与窗口重启。只允许 loopback 主 frame，通过受限桥接传递白名单统计。后台凭据仅在内存使用，匹配当前 PID 所属 HTTP 端口。

三系统共用同一套合并布局和 V4 桥接协议。每个宿主后台具有独立实例标识与绑定；data 目录中的 `active-sidecar.json` 由新实例原子接管，文件变更通知使旧实例的同步所有权缓存失效，每 2 秒的异步检查作为兜底，确认接管后解绑退出。采集和分页热路径只读取内存布尔值，不反复读取所有权／设置文件；运行边界仍异步复核。启动接管用短期文件锁串行化，异常退出的锁可恢复；不终止无关 PID。退出时只清理自身脚本和绑定，提交前取消旧实例的排队统计写入；已经交给操作系统的原子提交无法撤回。首次从没有接管保护的旧版升级，仍应完全退出宿主并清理已确认的旧插件后台；之后新实例可自动退役旧实例。

内嵌悬浮卡通过浏览器原生 popover 顶层展示，避免输入区层叠上下文导致宿主按钮遮挡；不支持该 API 的旧宿主回退为普通固定定位。

强调色优先跟随宿主当前生效的 `--primary` / `--color-primary`；配置中的 `userSettings.customThemeSeedsDark.primary` 与 `customThemeSeedsLight.primary` 提供深浅主题回退。切换主题或强调色无需重启；上下文环、上下文与额度进度条共用主色，小字号强调文字另行保证可读对比度。后台只传递有效颜色与主题模式，不传递完整配置，也不修改宿主设置。缺失或非法颜色恢复默认配色。

背景与文字同样跟随实际生效的 `--background`、`--popover` / `--card`、`--foreground`；只保存背景 seed 时，从同色系派生卡片、菜单、控件和轨道。配置中仅白名单传递 `background`、`foregroundOverride` 色值作为回退。支持宿主的 color-mix、OKLCH 等有效不透明颜色；文字与背景过于接近时调整对比度，移除颜色后清理旧覆盖值。

v0.5.2 的发布检查在三系统分别运行 Node 数据/路径/后台接管测试、Python 生命周期测试，以及 Chromium 中的主题切换、汉化布局和跨端口语言持久化测试。浏览器使用示意宿主和示例数据；它们不能证明 Linux/macOS 的已登录 App 界面已经实机验收。Windows 本轮修复已在当前真实 App 中验证；Linux/macOS 完整 App GUI 仍待实机确认。

汉化兼容：优先用 `role="combobox"` / `role="textbox"` 与 `contenteditable="true"` 识别输入区，用模型选择器的稳定 `data-testid` 定位；沿 DOM 包含关系找输入区与工具栏的共同父容器，不依赖发送、录音或取消按钮的英文/中文文案。旧版缺少语义属性时保留原英文标识回退。隐藏或存在歧义的候选不随意挂载；宿主若同时改变这些结构或标识，仍可能需要适配。

子代理 / Agent Manager 安全布局（#5）：共同父容器还必须是输入区附近的水平 flex 操作行，应用标题栏、远离输入区的工具栏和不支持的布局不挂载。监控条使用可收缩的有限宽度，不修改宿主模型按钮的 flex 或最小宽度，也不提高条本身的层级。完整内容放不下先保留三个图标，连图标都放不下或与实际可点击控件相交才隐藏并关闭悬浮卡；滚动消息中被遮盖的按钮不算可见碰撞；窗口变宽、按钮移开后自动恢复。浏览器测试覆盖中英文、300–1100px 窗宽、绝对定位按钮、点击命中、重挂载与宿主样式保留。拒绝内嵌挂载时可使用原生侧面板（需要宿主 SDK 兼容）；不保证未知子代理布局中仍有内嵌条。

v0.6.1 子代理展示：在 `[data-testid="agent-input-box"]` 内定位唯一编辑器、发送按钮和静态子代理身份标签，校验其水平操作行与编辑器的邻近关系后挂载。标签文字允许汉化，右侧文件面板的 combobox 不作为子代理锚点。数据请求使用当前 `/c/<id>`，只接收该 ID 的统计；切换父/子会话立即清空旧值，晚到或 ID 不匹配的响应被拒绝。窄窗口先保留速度、缓存和上下文三个图标，仍可打开各自详情；语言可在上下文卡中切换，详情注明“当前子代理统计”和账号共享额度。尚不支持任意浮动子代理窗口或同一页面多个会话同时展示各自监控条。

`python[3] manage.py status` 显示运行模式与健康状态：`mounted`、`waiting-for-composer`、`reconnecting`；检查 `checkedAt` 是否新鲜，历史文件不能证明当前后台仍在运行。原生侧面板是 SDK 兼容时的回退。

未来关闭调试通道、改变 DOM、SDK 或 RPC 仍可能需要适配，不保证所有未来版本无故障。`--legacy-loader` 仅为 Windows 2.19.1 历史迁移，不用于 Linux/macOS。未知归档修改不会被覆盖。

只保存白名单统计、模型/状态，不保存正文、标题、邮箱、凭据、原始上下文或 token breakdown。账号未确认不加载其他账号数据，缺失旧元数据不能凭空重建。完整故障矩阵见 [ROBUSTNESS.md](docs/ROBUSTNESS.md)。

v0.6.3 密度过渡：共享 desktop renderer 使用 Chromium Web Animations API 的 transform/opacity 过渡，只在完整统计与图标模式切换时创建视觉副本。连续调整宽度只更新安全裁剪范围，不重建动画；三图标模式恢复完整统计保留 12px 余量，减少临界抖动。宿主控件仍保留原布局和点击响应。Windows 本地验收已通过；Windows/Linux/macOS 的浏览器 fixture 纳入发布 CI，登录后的 Linux/macOS 实机 GUI 验收仍单独处理。
