# Glide GitHub 上线风险与发布闸门

## 当前结论

Glide 0.2.x 可以作为公开预览版放入 GitHub Releases，但在完成代码签名、真实网络测试和法律审查前，不应宣传为面向中国大陆的“保证可用”正式 VPN 服务。

## 主要风险

| 风险 | 用户影响 | 当前控制 | 正式发布闸门 |
| --- | --- | --- | --- |
| 中国大陆法律与许可 | 分发、运营或跨境联网可能产生合规责任 | 产品不代替用户注册，不绕过平台验证 | 由中国大陆执业律师审查业务模式、宣传和分发范围 |
| GitHub 可达性 | 部分用户无法首次下载或更新 | Release 提供完整包和校验值 | 准备合法、授权且可校验的备用发行源 |
| macOS Gatekeeper | 未公证应用出现警告或无法运行 | 当前仅作为明确标注的预览版 | Developer ID、Hardened Runtime、公证、stapling |
| Windows SmartScreen | 新二进制出现“未知发布者”警告 | CI 可构建 NSIS | 可信代码签名、固定发布者身份、干净安装测试 |
| GitHub 账号或 CI 被接管 | 攻击者替换 Release | 最小 GitHub Actions 权限，无发布密钥 | MFA、分支保护、环境审批、签名密钥隔离、制品证明 |
| 依赖供应链 | npm/Cargo 依赖被投毒 | lockfile、测试、CSP | Dependabot、依赖审查、固定 Action 版本、SBOM |
| 自动更新劫持 | 用户安装恶意升级 | 当前不自动更新 | 启用 Tauri 签名更新前先建立离线签名与回滚 |
| 本机凭据泄露 | 密码或订阅被其他进程读取 | 系统钥匙串、SQLite 拒绝秘密字段 | 权限审计、日志审查、恶意软件场景测试 |
| SSRF / DNS 重绑定 | 诊断被利用访问内网 | HTTPS、公网 DNS 校验、地址固定解析 | 独立渗透测试和模糊测试 |
| Cloudflare API 或配额变化 | 自动部署失败或线路不稳定 | 创建功能明确标注未开放 | 正式 OAuth、最小权限、幂等回滚、配额和变更监控 |
| 无遥测导致排障困难 | 难以发现大规模崩溃 | 本地脱敏诊断 | 用户主动导出、明确同意后再提交，不做默认上传 |

## 隐私与人数统计

严格本地存储意味着客户端不能可靠计算全网独立用户。任何全网去重标识都会形成远程用户档案或至少产生网络元数据。

采用以下方案：

1. 客户端仅展示本机启动次数、活跃天数和设备数；
2. 项目维护者通过 GitHub Releases API 的 `download_count` 查看聚合下载量；
3. 不把下载量描述为“活跃用户”或“独立用户”；
4. 不引入第三方分析 SDK、广告 ID、设备指纹或远程崩溃上报。

## GitHub 发布清单

- [ ] 源码与构建产物中无后台域名、密码、Token 或本机数据库
- [ ] 前端测试、Rust 测试、格式检查和严格 Clippy 全部通过
- [ ] 发布版本号、Release tag 与应用内版本一致
- [ ] 发布包附带 SHA-256 校验文件
- [ ] Release Notes 明确支持平台、签名状态和已知限制
- [ ] 在全新 macOS / Windows 用户账号执行安装、升级和卸载测试
- [ ] 启用 GitHub MFA、分支保护、Private Vulnerability Reporting
- [ ] 正式版完成 macOS 和 Windows 代码签名

## 官方参考

- 中国《计算机信息网络国际联网管理暂行规定》：
  <https://xzfg.moj.gov.cn/mobile/law/detail?LawID=1713>
- Apple macOS 公证：
  <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- Microsoft SmartScreen：
  <https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation>
- GitHub Releases API：
  <https://docs.github.com/rest/releases/releases>
