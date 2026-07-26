# Glide

Glide 是一个本地优先的个人网络连接管理器。它帮助用户添加自持线路、检查状态并把订阅复制到开源客户端。应用没有账号系统、远程用户档案或遥测。

## 当前可用能力

- Apple 风格的 macOS/Windows 桌面界面；
- 面向新用户的空白工作区与三步引导；
- 已有管理后台的 HTTPS、域名和 SSRF 安全校验；
- 管理密码与设备订阅写入 macOS Keychain / Windows Credential Manager；
- 非敏感工作区状态写入本地 SQLite；
- 凭据重复、地区证据和管理入口诊断；
- 首次使用三步清单、导入进度、线路筛选和明确的错误反馈；
- 设备订阅二维码、一次性复制、本机移除确认和服务端轮换指导；
- Clash Verge Rev、v2rayN、Hiddify 官方发布入口；
- macOS 与 Windows 独立品牌图标和构建配置。
- 本机启动次数、活跃天数和设备数统计，可随时清除；
- 工作区敏感字段拒绝、SQLite 权限收紧和诊断地址脱敏。

## 隐私

- 密码和订阅仅进入 macOS Keychain / Windows Credential Manager；
- 线路、本机统计和脱敏诊断仅写入本地 SQLite；
- 不加载统计 SDK，不发送设备 ID、IP、启动事件或诊断结果；
- 用户主动检查连接时，只访问用户填写的管理地址；
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

双击桌面上的 `Glide.app`，或项目根目录中的 `Glide.app`。

当前构建是 GitHub 预览版本。正式面向陌生用户分发前，macOS 仍需 Developer ID 签名与公证，Windows 仍需可信代码签名。

## 当前产品边界

- 已有部署导入是只读的：校验 HTTPS、公网地址和可达性，不会修改线上配置；
- Cloudflare 自动新建仍等待正式 OAuth Client ID、回调地址和供应商审核，界面不会伪造授权成功；
- 删除设备记录只删除本机钥匙串内容，不等同于撤销远端订阅；
- 国家/地区标签必须由独立探测证据验证，不能用配置名称代替真实出口结论；
- Windows 安装包需要在 Windows CI 或构建机生成，macOS 不能产出可信的 Windows 签名安装包。
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
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

测试覆盖域逻辑、输入校验、首次使用状态、导航与线路筛选；桌面发布前还需在真实
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
- 不接受 Cloudflare Global API Key；
- 不自动绕过验证码、实名或平台安全措施；
- 不把免费资源宣传成永久、无限或保证在中国大陆稳定；
- 不对未知目标执行请求，诊断入口必须使用 HTTPS，并阻止本机、私网和保留地址；
- 创建、轮换、删除和接管云端资源前必须显示变更计划并再次确认。

完整产品方案见 [docs/vpn-automation-product-plan.md](docs/vpn-automation-product-plan.md)。
上线风险与发布闸门见 [docs/production-readiness.md](docs/production-readiness.md)。
专业设置流程见 [docs/operating-standard.md](docs/operating-standard.md)。
安全问题报告方式见 [SECURITY.md](SECURITY.md)。

## 图标

- macOS 矢量源稿：`src-tauri/icons/macos-icon.svg`
- macOS 应用图标：`src-tauri/icons/macos/icon.icns`
- Windows 矢量源稿：`src-tauri/icons/windows-icon.svg`
- Windows 应用图标：`src-tauri/icons/windows/icon.ico`
- AI 概念参考：`design/icon-concepts/`
