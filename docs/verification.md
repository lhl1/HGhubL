# 验证范围与复现方法

当前版本：**1.5.7**。记录日期：**2026-11-12**。Release 随附 `validation.json` 和 `SHA256SUMS.txt`，用于查看该次实际构建结果与文件校验。

## 检查覆盖什么

| 检查 | 当前基线 | 覆盖 |
| --- | ---: | --- |
| `reference-ui` | 44 | 桌面壳、主题迁移、分类、榜单、排序与搜索 |
| `optimization` | 56 | 分页代次、去重、播放偏好、重试预算、菜单首次展开 |
| `discovery` | 62 | 启动放映、首页、探索分区、专题、标签、图文、热词、间距 |
| `immersive` | 65 | 隐藏、返回、全屏尺寸、媒体状态保持、选集、综合分 |
| `playback-retry` | 8 | 空媒体实例重试、换片、旧回包隔离 |
| `security-settings` | 8 | 后端确认后生效、安全模式切换 |
| `html-security` | 31 | 正文清洗、协议和链接处理 |
| **浏览器合计** | **274** | 模拟业务 / 媒体 / 原生窗口接口 |
| Rust 离线测试 | 38 通过 | 网络目标、缓存、会话、取址协议绑定、参数等 |
| Rust 联网测试 | 10 默认忽略 | 按需执行，不计入默认离线通过数 |

增加文档和发布链接不会自动增加检查数量。历史文档中的计数对应当时版本；当前值以本表和本次发布结果为准。

## 本地复现

依赖安装后：

```powershell
pnpm build
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
./scripts/test-browser.ps1
```

Windows GNU 环境可用 `scripts/test-windows-gnu.ps1` 代替原始 cargo test，处理库测试程序所需的 Common Controls v6 manifest。脚本只处理本项目生成的测试程序。

浏览器脚本使用独立 headless Edge 配置目录，自己启动 Vite；运行前请让 1420 端口空闲。它逐项读取测试页面的 JSON 结果，任一失败就返回非零状态，不访问真实用户浏览器。

也可手动运行 `pnpm dev --host 127.0.0.1`，依次访问 `http://127.0.0.1:1420/tests/<名称>.html`。部分夹具需要直接阅读页面末尾的 JSON，不是完整可用客户端。

## 实际鼠标与视觉检查

发布前在自有隔离浏览器中，用鼠标单击打开榜单下拉框，确认第一次点击保留弹层；使用 End 键确认只滚动列表。另检查独立热搜词、首页板块间距、深浅色和窄窗口。

文档中的截图为离线测试夹具：标题、分数、作者及封面均为演示数据，不是已连接真实视频或上游账号的截图。

## 原生构建与图标

```powershell
node node_modules/@tauri-apps/cli/tauri.js build --no-bundle
```

本地发布包使用 Windows GNU 工具链构建，随包携带 loader。检查 FileVersion 与 package / Tauri / Cargo 四处版本一致；读取 EXE PE 图标资源，逐项核对 16、24、32、48、64 和 256 尺寸与 ICO 一致；发布 ZIP 每一项也与磁盘文件校验。

新仓库 CI 使用 Windows runner 默认 Rust 工具链进行独立检查。本地 GNU 构建与 CI 构建使用的编译器和打包形式不同，不能仅凭文件名声称二进制逐字节可复现。

## 可选联网检查

默认不执行。上游服务变化、失效作品或网络环境都可能导致结果变化。

```powershell
./scripts/test-windows-gnu.ps1 -Filter discovery::tests::discovery_live -Live
./scripts/test-windows-gnu.ps1 -Filter discovery::tests::catalog_live -Live
./scripts/test-windows-gnu.ps1 -Filter api::rating_tests::rating_live -Live
```

以上按需验证少量公开列表和综合分读取，不提交真实评分。测试所需代理通过正常用户配置传入，不把私人代理凭据写入仓库。

`discovery-source.html` 是独立的公开网页结构快照测试，需要额外本地快照服务，不属于默认 274 项。仓库不发布采集的原网页正文、真实播放分片或用户账户数据。

## 不能从这些结果推断什么

- 浏览器窗口桩通过，不等于本轮已完成 Windows 原生全屏按键实机操作。
- 离线行为通过，不保证所有上游视频、线路和网络实时可用。
- Windows 构建成功，不等于 Android、macOS 或 Linux 已测试通过。
- 没有真实账号登录/评分提交结果，也没有声称安装包经过代码签名或所有杀毒引擎检查。

## 发布流程

1. 对齐版本和文档，保留原工程、旧包及远端初始状态的备份。
2. 检查源文件清单，排除依赖、target、缓存、会话、密钥、原网页快照和个人诊断。
3. 构建与验证，将 README 配图明确标为演示界面。
4. 提交代码并推送 main，建立版本 tag，发布便携包、对应源码和 SHA256。
5. 从 GitHub 核对提交、Release 状态、资产尺寸和摘要，确认公开下载可见。

CI 只验证和编译，不自动覆盖人工校验过的 Release 资产。Android 签名及跨平台发布不与 Windows 发布绑定。
