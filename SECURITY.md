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

- 网络检查只接受 HTTPS `/admin` 入口，并阻止本机、私网、未知保留地址和 DNS
  重绑定；仅对标准 `198.18.0.0/15` Fake-IP 映射开放窄例外，且请求仍须通过原始
  域名的 TLS 证书验证；
- 管理登录不跟随重定向，只接受格式严格的短期认证 Cookie，并限制配置响应为 1 MiB；
- 后台密码写入 Glide 专属凭据目录中的 AES-256-GCM 加密数据库；随机密钥与密文
  分文件保存，macOS/Linux 目录权限为 `0700`、文件为 `0600`，Windows 继承当前用户
  AppData ACL；
- 凭据写入使用 SQLite `BEGIN IMMEDIATE` 事务并保留上一版密文；并发实例不会以
  非原子方式覆盖文件，主密文损坏时可读取上一版；
- Glide 不请求、读取或保存电脑登录密码，后台管理操作不再触发系统凭据弹窗；
- 真实订阅和用户选中的单节点 URI 只在显式操作后进入前端内存，不进入 SQLite
  或日志；节点列表只返回哈希标识、名称、协议、区域标签和脱敏延迟结果，不返回
  URI、主机名或端口；TLS 节点必须完成证书校验和响应头握手，普通 TCP 的透明代理
  瞬时结果不作为有效延迟返回；
- 系统 DNS 被 Fake-IP 接管或解析失败时，仅把节点域名发送到固定 HTTPS DNS
  解析器；响应限制为 64 KiB，只接受 A/AAAA 公网地址并继续阻止本机、私网与保留地址；
- 订阅 URL 强制携带 `target=mixed`，防止 Clash/Sing-box User-Agent 触发上游第三方
  转换服务并暴露节点配置；
- 订阅地址由已认证配置生成，必须使用同源 HTTPS，并在报告成功前读取且识别为受支持的订阅内容；伪装 HTML 与普通错误文本不会被当作成功，响应上限为 2 MiB；
- 一键优化把单条线路的后台读取与订阅验证合并为一次认证会话，单条探针有 25 秒硬截止；
- SQLite 拒绝常见秘密字段，并在 Unix 系统收紧目录和文件权限；
- 外部链接同时受前端主机允许列表与 Tauri capability 约束；
- Cloudflare 创建首选系统浏览器 OAuth Authorization Code + S256 PKCE，使用随机
  state、一次性 verifier、固定本机回环回调、5 分钟截止和重复参数拒绝；发行包未
  配置发布者 Client ID 时才提供高级短期最小权限 API Token，不接受 Global API Key；
- OAuth access token 或高级 Token 只保留在当前创建页面的进程内存，允许用户连续
  创建多条线路；完成或取消时只删除一次，离开页面或退出时由卸载清理兜底销毁；
- 创建命令只能读取固定的 Cloudflare 临时授权引用，不能把其他本机凭据作为 API Token
  发送；取消或离开向导时尽力删除该临时项；
- 云端写入前展示带校验值的确定性计划，确认时重新核对；只回滚本次新建的 Worker
  和 KV，不删除可能被其他 Worker 共享的账号级公共子域；
- Worker 载荷固定到上游提交并校验大小与 SHA-256；复用时还校验固定部署注解和 KV
  绑定，同名未知或不完整资源不会被启用或覆盖；
- CSP 禁止远程脚本，应用不加载遥测 SDK；
- GitHub Actions 使用固定提交 SHA，Node/Rust 使用精确版本，npm 锁文件使用官方仓库；
- GitHub 发布包必须附带由测试过的跨平台工具生成的 SHA-256 校验值。

本地无弹窗方案的安全边界：随机加密密钥与密文都位于当前用户的专属应用目录，
因此它能防止明文泄露、普通备份误读和其他操作系统账号直接读取，但不能抵御已经取得
同一用户权限的恶意程序。用户仍应启用 FileVault/BitLocker、系统登录保护和恶意软件
防护。Glide 不会把这种取舍描述成硬件密钥或系统凭据库等级的隔离。

## Release requirements

正式版本必须通过全部前端与 Rust 测试、严格 Clippy、秘密扫描和依赖审查。macOS 发布应使用 Developer ID、公证和 stapling；Windows 发布应使用可信代码签名并验证 SmartScreen 行为。

0.6.2 现场审查中，npm 生产依赖没有已知漏洞；RustSec 没有报告漏洞，但 Tauri
依赖链仍有停止维护警告。Linux GTK3 警告不进入当前 macOS/Windows 目标，
`unic-*` 警告需随 Tauri 上游迁移持续跟踪。

0.6.2 已实现 OAuth + PKCE 客户端链路。公开发行前仍必须完成 Cloudflare 发布者域名、
Client ID、精确 scopes 和真实账号授权验收；未配置的发行包只能标记为 Token Beta。
