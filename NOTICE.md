# 来源与署名

HGhubL 是基于 [Minireel/HGhub](https://github.com/Minireel/HGhub) 源码制作的适配版本，由 **ENIAC** 维护本仓库的界面与功能调整。它不是内容站点的官方客户端，也不代表上游项目维护者。

保留原项目的 Tauri + Rust + React 框架，主要调整 Windows 桌面体验、播放兼容、首页与探索、全屏行为、评分展示、选集和主题。桌面视觉与部分交互参考了开发时提供的 `windows-client` 项目；本仓库不包含该项目的 Electron 运行时或其完整源码。

上游许可声明原文保留在 [LICENSE](LICENSE)：

> Required Notice: Copyright (c) 2026 HGhub contributors (https://github.com/Minireel/HGhub)

本项目继续使用 **PolyForm Noncommercial 1.0.0**。修改、再分发时请保留许可全文和 Required Notice，并遵守非商业用途要求。ENIAC 的界面署名不替代上游版权声明。

React、Tauri、hls.js、DOMPurify 等第三方依赖按其各自许可证使用；确切版本可查 `package.json`、`pnpm-lock.yaml` 与 `src-tauri/Cargo.lock`。
