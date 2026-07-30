# Glide

Glide 是一个本地优先的个人网络连接管理器。它帮助用户添加自持线路、检查状态并把订阅复制到开源客户端。应用没有账号系统、远程用户档案或遥测。

## 当前可用能力

- Apple 风格的 macOS/Windows 桌面界面；
- 面向新用户的“添加—优化—导入”三步引导；
- 已有管理后台的真实登录、配置解析、HTTPS 与 SSRF 安全校验；
- Cloudflare Workers 自动创建 Beta：系统浏览器 OAuth + S256 PKCE、一键授权、变更
  预览、幂等创建、失败回滚和部署后真实订阅验证；发行包未配置发布者 Client ID 时
  才展示高级 API Token 方式；
- 旧版演示线路可原地补录管理地址和密码，无需删除重建；
- 兼容 Clash/Mihomo 标准 Fake-IP，同时强制校验原始域名 TLS 证书；
- 一键优化以最多 4 路受控并发完成管理配置和真实订阅验证，并对小型连接组执行两轮复测；
- 用户主动执行一键优化时直接选择本轮综合第一，不沿用历史线路；排序包含响应波动
  惩罚、健康度、凭据风险与订阅状态，地区标签不参与线路得分；
- 首页明确区分“线路”和“节点”：先验证线路，再从该线路的真实订阅中发现节点；
- 支持在本轮已验证线路之间按节点备注切换香港、日本、新加坡、台湾、美国和未识别
  区域；TLS 节点通过证书校验和响应头握手取得三次中位延迟与波动，Fake-IP 时使用
  可信 DNS 解析真实公网地址，透明代理的瞬时 TCP 结果不会冒充真实延迟；
- 节点列表提供独立“重新测速”，不必重跑全部线路或重新输入后台密码；
- 手动选择线路与节点都会重新读取真实订阅，内容变化时不会误用旧节点；
- 优化后整条订阅与当前节点保持为两个独立导出对象，可分别复制或生成临时二维码；
- 订阅固定为隐私优先的 `mixed` 原始格式，阻止客户端 User-Agent 触发第三方订阅
  转换；当前优先使用支持原始 VLESS 订阅的客户端；
- 管理密码保存在 Glide 专属本机目录中的 AES-256-GCM 加密数据库，应用可直接读取，
  不再触发电脑密码弹窗；
- Cloudflare OAuth access token 或高级短期 API Token 只保留在当前创建页面的进程
  内存，可连续创建多条线路；用户完成或取消时只删除一次，离开页面或退出应用时由
  卸载清理兜底销毁；
- 旧版多凭据首次升级时只需输入一次共同的后台密码完成迁移；
- 非敏感工作区状态写入本地 SQLite；
- 凭据重复、地区证据和管理入口诊断；
- 导入进度、可操作错误反馈和本机移除确认；
- Clash Verge Rev、v2rayN、Hiddify 官方发布入口；
- macOS 与 Windows 独立品牌图标和构建配置；
- 工作区敏感字段拒绝、SQLite 权限收紧和诊断地址脱敏。

## 隐私

- 后台密码只进入 Glide 专属本机加密目录；电脑登录密码不会被请求、读取或保存；
- 真实订阅仅在用户操作后的内存、二维码或剪贴板中短暂停留，不写入 SQLite；
- 线路和脱敏诊断仅写入本地 SQLite；
- 不加载统计 SDK，不发送设备 ID、IP、启动事件或诊断结果；
- 用户主动检查连接时访问用户填写的管理地址；只有节点域名被本机 Fake-IP 接管或
  系统 DNS 失败时，才把节点域名（不含 UUID、路径和订阅 Token）发送到阿里公共 DNS
  或 Cloudflare DNS 解析真实公网地址；
- GitHub Release 下载量用于了解发行规模，不在客户端埋点。

完整说明见 [PRIVACY.md](PRIVACY.md)。

## GitHub 下载

公开版本通过 GitHub Releases 分发，每个发布包同时提供 SHA-256 校验文件。下载后先核对校验值，再运行应用。

macOS：

```bash
shasum -a 256 Glide-*.zip
```

Windows：

```powershell
Get-FileHash .\Glide-*.exe -Algorithm SHA256
```

## 启动 macOS App

双击桌面上的 `Glide.app`。该入口指向当前项目构建出的最新版本。

当前构建是 GitHub 预览版本。正式面向陌生用户分发前，macOS 仍需 Developer ID 签名与公证，Windows 仍需可信代码签名。

## 当前产品边界

- 已有部署导入是只读的：真实登录并读取受支持的管理配置，不会修改线上配置；
- 当前适配 `cmliu/edgetunnel` 管理协议；上游接口变化时会明确提示版本不兼容；
- 一键优化会选择并验证线路，但不会把节点名称当成出口地区实测，也不会绕过第三方
  客户端权限直接切换其活动连接；用户仍需复制或扫码导入；
- 一键优化使用两轮管理入口与真实订阅响应作为当前可用性证据，不把它宣传成真实隧道吞吐或长期稳定性；
- 多个域名若共用 UUID 和节点路径，仍属于同一故障域，不能视作完整容灾；
- 0.6.2 已实现系统浏览器 OAuth Authorization Code + S256 PKCE、本机回环回调、
  随机 state 和一次性 verifier；GitHub 发行包必须先配置并验证发布者 Client ID
  与精确权限范围，否则界面会明确降级到高级短期 API Token；
- 当前自动创建的是 `workers.dev` 试用入口；Cloudflare 建议生产 Worker 使用自定义
  域名或 Route，本版本不会自动接管域名或修改 DNS；
- 创建路径固定并校验上游 `cmliu/edgetunnel` 载荷，许可与归属见
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；
- 国家/地区标签必须由独立探测证据验证，不能用配置名称代替真实出口结论；
- Windows 安装包需要在 Windows CI 或构建机生成，macOS 不能产出可信的 Windows
  签名安装包；
- GitHub 在部分网络环境下可能不可达或速度不稳定，因此不能保证中国大陆用户无需其他网络条件即可完成首次下载。

## 开发

```bash
npm install
npm run dev
```

桌面开发：

```bash
npm run tauri -- dev
```

验证：

```bash
npm run test:coverage
npm run test:tooling
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

测试覆盖域逻辑、输入校验、凭据迁移、真实订阅回退、导航与连接管理；桌面发布前还需在真实
macOS 与 Windows 环境完成键盘、VoiceOver/Narrator、签名和安装升级测试。

## 构建

macOS：

```bash
npm run tauri -- build --bundles app
```

Windows：

```powershell
npm run tauri -- build --bundles nsis
```

Windows 安装包应在 Windows 构建机生成。正式分发前必须配置可信代码签名；macOS 正式分发前必须完成 Developer ID 签名、公证和 stapling。

## 安全边界

- 不在源码、SQLite、日志或遥测中保存真实密码、Cloudflare Token 或订阅 URL；
- 后台密码只进入独立的加密凭据数据库；普通工作区 SQLite 仍拒绝任何秘密字段；
- 不接受 Cloudflare Global API Key；
- 不自动绕过验证码、实名或平台安全措施；
- 不把免费资源宣传成永久、无限或保证在中国大陆稳定；
- 不对未知目标执行请求，诊断入口必须使用 HTTPS，并阻止本机、私网和保留地址；
- 创建、轮换、删除和接管云端资源前必须显示变更计划并再次确认。

完整产品方案见 [docs/vpn-automation-product-plan.md](docs/vpn-automation-product-plan.md)。
上线风险与发布闸门见 [docs/production-readiness.md](docs/production-readiness.md)。
专业设置流程见 [docs/operating-standard.md](docs/operating-standard.md)。
运维、备份与故障恢复见 [docs/operations-runbook.md](docs/operations-runbook.md)。
自动部署架构见 [docs/cloudflare-deployment-architecture.md](docs/cloudflare-deployment-architecture.md)。
安全问题报告方式见 [SECURITY.md](SECURITY.md)。

## 图标

- macOS 矢量源稿：`src-tauri/icons/macos-icon.svg`
- macOS 应用图标：`src-tauri/icons/macos/icon.icns`
- Windows 矢量源稿：`src-tauri/icons/windows-icon.svg`
- Windows 应用图标：`src-tauri/icons/windows/icon.ico`
- AI 概念参考：`design/icon-concepts/`
