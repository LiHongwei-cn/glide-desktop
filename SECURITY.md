# Security Policy

## Supported versions

只有最新 GitHub Release 接收安全修复。预览版不是经过第三方审计的正式 VPN 产品。

## Reporting a vulnerability

请使用 GitHub 仓库的 Private Vulnerability Reporting / Security Advisory 私下报告。不要在公开 Issue 中粘贴：

- 管理后台地址；
- 密码、Token、UUID 或订阅；
- 完整 IP、日志或截图中的个人信息。

报告应包含受影响版本、操作系统、复现步骤和已经脱敏的证据。高风险问题包括凭据泄露、任意网络请求、更新劫持、路径遍历、任意代码执行和本地权限绕过。

## Security boundaries

- 网络检查只接受 HTTPS `/admin` 入口，并阻止本机、私网、保留地址和 DNS 重绑定；
- 密码与订阅使用系统凭据库，不进入 SQLite；
- SQLite 拒绝常见秘密字段，并在 Unix 系统收紧目录和文件权限；
- 外部链接同时受前端主机允许列表与 Tauri capability 约束；
- CSP 禁止远程脚本，应用不加载遥测 SDK；
- GitHub 发布包必须附带 SHA-256 校验值。

## Release requirements

正式版本必须通过全部前端与 Rust 测试、严格 Clippy、秘密扫描和依赖审查。macOS 发布应使用 Developer ID、公证和 stapling；Windows 发布应使用可信代码签名并验证 SmartScreen 行为。
