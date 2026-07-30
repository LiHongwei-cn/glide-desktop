# Glide GitHub 上线风险与发布闸门

## 当前结论

Glide 0.6.1 可以作为受控预览版，但在完成真实 Cloudflare 创建验收、代码签名、
供应商确认和法律审查前，不应宣传为面向中国大陆的“保证可用”正式 VPN 服务。

## 主要风险

| 风险 | 用户影响 | 当前控制 | 正式发布闸门 |
| --- | --- | --- | --- |
| 中国大陆法律与许可 | 分发、运营或跨境联网可能产生合规责任 | 产品不代替用户注册，不绕过平台验证 | 由中国大陆执业律师审查业务模式、宣传和分发范围 |
| GitHub 可达性 | 部分用户无法首次下载或更新 | Release 提供完整包和校验值 | 准备合法、授权且可校验的备用发行源 |
| macOS Gatekeeper | 未公证应用出现警告或无法运行 | 当前仅作为明确标注的预览版 | Developer ID、Hardened Runtime、公证、stapling |
| Windows SmartScreen | 新二进制出现“未知发布者”警告 | CI 可构建 NSIS | 可信代码签名、固定发布者身份、干净安装测试 |
| GitHub 账号或 CI 被接管 | 攻击者替换 Release | 最小 Actions 权限、固定 Action SHA、无发布密钥 | MFA、分支保护、环境审批、签名密钥隔离、制品证明 |
| 依赖供应链 | npm/Cargo 依赖被投毒 | 官方仓库 lockfile、精确工具链、测试、CSP | Dependabot、依赖审查、SBOM |
| 自动更新劫持 | 用户安装恶意升级 | 当前不自动更新 | 启用 Tauri 签名更新前先建立离线签名与回滚 |
| 本机凭据泄露 | 同一用户权限的恶意程序同时读取密钥和密文 | AES-256-GCM、密钥/密文分文件、用户专属权限、工作区拒绝秘密字段 | FileVault/BitLocker 指引、权限审计、恶意软件场景测试 |
| 系统权限弹窗过多 | 用户无法日常使用管理和优化 | 后台密码改为应用专属加密目录，Cloudflare Token 仅内存 | 全新账号与升级重启回归 |
| SSRF / DNS 重绑定 | 诊断被利用访问内网 | HTTPS、公网 DNS 校验、地址固定解析 | 独立渗透测试和模糊测试 |
| Cloudflare API 或配额变化 | 自动部署失败或线路不稳定 | OAuth + PKCE、Token 兜底、计划校验、幂等回滚、锁定载荷 | 公共 OAuth Client、真实账号验收、配额和变更监控 |
| 上游 Worker 供应链或许可 | 恶意载荷、功能变化或再分发风险 | 固定提交、SHA-256、GPL-2.0 归属 | 上游更新审查、SBOM、法律复核 |
| 无遥测导致排障困难 | 难以发现大规模崩溃 | 本地脱敏诊断 | 用户主动导出、明确同意后再提交，不做默认上传 |

## 隐私与人数统计

严格本地存储意味着客户端不能可靠计算全网独立用户。任何全网去重标识都会形成远程用户档案或至少产生网络元数据。

采用以下方案：

1. 客户端不显示伪装成“用户人数”的本机启动计数；
2. 项目维护者通过 GitHub Releases API 的 `download_count` 查看聚合下载量；
3. 不把下载量描述为“活跃用户”或“独立用户”；
4. 不引入第三方分析 SDK、广告 ID、设备指纹或远程崩溃上报。

## GitHub 发布清单

- [x] 源码与构建产物中无后台域名、密码、Token 或本机数据库
- [x] 前端 66 项（语句 91.48%、分支 84.14%）、Rust 50 项、发布工具 2 项、格式
      检查和严格 Clippy 通过
- [x] 仅监听 `127.0.0.1` 的 Cloudflare API、OAuth 和凭据库测试在获批本机环境完整通过
- [x] 五条已保存线路完成真实优化、跨线路区域切换和节点/订阅独立导出回归
- [x] 发布版本号与应用内版本一致
- [x] 发布包附带 SHA-256 校验文件
- [x] Release Notes 明确支持平台、签名状态和已知限制
- [x] npm/RustSec 依赖审查未发现已知漏洞；Tauri 传递依赖的停止维护警告已记录
- [ ] 在全新 macOS / Windows 用户账号执行安装、升级和卸载测试
- [ ] 用用户本人新建 Cloudflare 账号完成创建、订阅、重试和回滚验收
- [ ] 创建发布者 Cloudflare OAuth Client、验证域名、设为 Public，并将公开 Client ID
      与最小权限 scopes 配置到 GitHub Actions Variables
- [ ] 启用 GitHub MFA、分支保护、Private Vulnerability Reporting
- [ ] 正式版完成 macOS 和 Windows 代码签名

## 依赖审查记录

2026-07-28 的 `npm audit --omit=dev` 报告生产依赖 0 个已知漏洞。RustSec 扫描
495 个 Cargo 依赖，报告 0 个漏洞和 17 条允许警告：

- GTK3/glib 与 `proc-macro-error` 警告不进入 macOS arm64 或 Windows x64 目标；
- 5 个停止维护的 `unic-*` 包经 Tauri `urlpattern` 依赖链进入目标；
- 这些警告当前不是漏洞，但必须随 Tauri 上游更新持续跟踪，正式发布前重新扫描。

## 官方参考

- 中国《计算机信息网络国际联网管理暂行规定》：
  <https://xzfg.moj.gov.cn/mobile/law/detail?LawID=1713>
- Apple macOS 公证：
  <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- Microsoft SmartScreen：
  <https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation>
- GitHub Releases API：
  <https://docs.github.com/rest/releases/releases>
