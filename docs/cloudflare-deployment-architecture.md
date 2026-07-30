# Cloudflare 自动部署架构

## 结论

Glide 0.6.2 提供本地优先的 Cloudflare Workers 创建 Beta。首选流程使用系统浏览器
OAuth Authorization Code + S256 PKCE；Glide 不收集账号密码，也不接受 Global API
Key。发行包未配置已审核的发布者 Client ID 时，界面会明确禁用一键登录并展开高级、
最小权限、短有效期 API Token 方式，不会伪装成可用。

API Token 模式用于在取得 OAuth Client ID、发布者域名和供应商审核前验证完整部署
状态机。
一个已验证 Token 可在同一创建页面连续创建多条线路；显式完成或取消时只删除一次，
离开页面或退出应用时由卸载清理兜底销毁内存副本。

## 最小权限

Token 仅需要账号范围内的：

- Account Settings Read；
- Workers Scripts Edit；
- Workers KV Storage Edit。

建议把 Token 有效期设置为 1 天。Token 只使用固定的
`cloudflare-auth:pending` 临时引用并保留在当前创建页面的进程内存；创建命令拒绝读取
其他本机凭据。用户完成或取消时显式删除一次，离开向导或应用退出时由卸载清理
兜底销毁。短有效期和 Cloudflare 控制台撤销仍是服务端最终失效保障。

## 状态机

1. **授权验证**：只请求 Cloudflare 官方 `GET /accounts`，返回可用账号列表。
2. **只读预检**：读取账号、Workers 子域、脚本、KV 状态，以及已有 Worker 的部署
   注解和 KV 绑定。
3. **确定性计划**：用账号 ID 与用户显示名称派生 `glide-` 前缀资源名，生成包含
   资源存在状态和上游 SHA-256 的计划校验值。
4. **明确确认**：UI 展示公共子域、KV、Worker 和入口变更；用户点击“确认并创建”
   前不写云端。
5. **载荷预取**：从锁定的 GitHub 提交下载 `_worker.js`，限制大小并校验 SHA-256。
6. **幂等创建**：必要时创建 Workers 子域、KV、Worker，写入 `ADMIN` secret，并
   启用该 Worker 的 `workers.dev` 入口。
7. **端到端验证**：在同一次认证快照中真实登录 `/admin`、读取受支持配置、生成并
   读取订阅，并解析出至少一个可单独选择的节点；三项都通过才把连接加入本机工作区。
8. **回滚**：失败时只删除本次创建的 Worker 和 KV，不删除或覆盖已有资源。新注册的
   Workers 公共子域属于账号级共享设置，为避免影响并发创建的其他 Worker 会保留。

## 冲突与重试

- 云端同名资源存在但本机没有对应管理凭据时立即停止；
- Worker 存在但配套 KV 缺失时立即停止，不自动覆盖未知脚本；
- 已有 Worker 的固定部署注解或 KV 命名空间绑定不匹配时立即停止，不启用未知代码；
- 已有 Worker 不会被重新上传或改写管理员 secret；
- 确认前会重新生成计划；云端状态变化会使计划校验失败并要求重新确认；
- 确认后的子域竞态也会再次比较，发现变化立即停止；
- 创建中断后可复用本机已识别的完整资源，但不把“修复”当作覆盖授权。
- 回滚不删除账号级 Workers 公共子域；它可能被其他 Worker 共享，删除风险高于保留。
- 连续创建使用账号 ID 和每条显示名称共同派生唯一资源后缀；三条中文名称也不会
  因 ASCII slug 退化为 `connection` 而发生碰撞。

## 供应链与许可

部署载荷固定到 `cmliu/edgetunnel` 提交
`fa5a3a6022d46fb18ed251974556fd98ac0ee2f7`，SHA-256 为
`3db0ef9c55ceb1aa9706697fdb0ae7472169d308fa4317490372844afc884de1`。
归属和 GPL-2.0 许可见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 已知边界

- GitHub Raw 或 Cloudflare API 在用户网络不可达时，自动创建无法完成；
- `workers.dev` 在中国大陆的可达性和性能不由 Glide 控制，不能承诺稳定直连；
- Cloudflare 建议生产 Worker 使用自定义域名或 Route；当前 Beta 的 `workers.dev`
  入口只用于试用和端到端验收；
- 当前创建的是 Cloudflare Worker，不自动购买或接管域名，也不修改 DNS；
- Cloudflare 免费额度、API 和可接受使用规则会变化；
- 在完成用户本人 Cloudflare 账号的端到端测试前，模拟 API 测试不能替代真实验收；
- macOS/Windows 正式发行仍需要可信代码签名。

## OAuth 发行配置

实现使用系统浏览器、S256 PKCE、随机 `state`、一次性 verifier 和固定回调
`http://127.0.0.1:49217/oauth/callback`。回调只监听本机回环地址，最多等待 5 分钟，
并拒绝错误路径、非回环来源、重复安全参数和 state 不匹配。

GitHub 仓库需配置两个非秘密 Actions Variables：

- `GLIDE_CLOUDFLARE_OAUTH_CLIENT_ID`：发布者已注册且完成域名验证的公共 Client ID；
- `GLIDE_CLOUDFLARE_OAUTH_SCOPES`：与该 Client 审核结果完全一致的最小权限范围。

Client 不使用内置 secret。OAuth access token 只保存在当前创建会话内存；拒绝、过期
和账号切换都有明确状态。未配置变量时构建仍可完成，但只能使用高级 Token 方式。

Cloudflare 的发布者配置必须选择 Authorization Code、`token_endpoint_auth_method=none`
和 S256 PKCE，并把上述固定回调加入允许列表。新 Client 默认为 Private；面向任意
GitHub 用户前必须设置名称、Logo、Client URL 和 scopes，完成 Client URL 域名 DNS
所有权验证，再永久提升为 Public。软件不能替发布者在用户机器上自动完成这些步骤。
