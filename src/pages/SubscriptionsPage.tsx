import {
  Check,
  Clipboard,
  KeyRound,
  Laptop,
  Plus,
  QrCode,
  RotateCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import QRCode from "qrcode";
import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Badge, Button, Dialog } from "@/components/ui";
import type { DeviceCredential } from "@/domain/models";
import { normalizeSubscriptionEndpoint } from "@/domain/validation";
import { isDesktopRuntime, storeSecret } from "@/services/desktop";

interface SubscriptionsPageProps {
  devices: DeviceCredential[];
  onAddDevice: (device: DeviceCredential) => void;
  onRevokeDevice: (deviceId: string) => Promise<void>;
}

interface PairingResult {
  deviceName: string;
  qrDataUrl: string;
  subscriptionUrl: string;
}

export function SubscriptionsPage({
  devices,
  onAddDevice,
  onRevokeDevice,
}: SubscriptionsPageProps) {
  const [copied, setCopied] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [pairingResult, setPairingResult] = useState<PairingResult | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<DeviceCredential | null>(null);
  const [removing, setRemoving] = useState(false);
  const [rotationDevice, setRotationDevice] = useState<DeviceCredential | null>(null);
  const [subscriptionUrl, setSubscriptionUrl] = useState("");
  const desktop = isDesktopRuntime();

  async function createDevice() {
    setError("");
    try {
      const normalizedUrl =
        normalizeSubscriptionEndpoint(subscriptionUrl).normalizedUrl;
      const id = crypto.randomUUID();
      const credentialReference = `device-subscription:${id}`;
      if (desktop) {
        await storeSecret(credentialReference, normalizedUrl);
      }
      const qrDataUrl = await QRCode.toDataURL(normalizedUrl, {
        color: { dark: "#151518", light: "#ffffff" },
        errorCorrectionLevel: "M",
        margin: 2,
        width: 240,
      });
      onAddDevice({
        createdAt: new Date().toISOString(),
        credentialReference,
        displayName: deviceName.trim(),
        id,
        status: "active",
      });
      setPairingResult({
        deviceName: deviceName.trim(),
        qrDataUrl,
        subscriptionUrl: normalizedUrl,
      });
      setDeviceName("");
      setSubscriptionUrl("");
    } catch (creationError) {
      setError(
        creationError instanceof Error ? creationError.message : "无法创建设备订阅。",
      );
    }
  }

  function closeAddDialog() {
    setCopied(false);
    setDialogOpen(false);
    setError("");
    setPairingResult(null);
    setSubscriptionUrl("");
  }

  async function copySubscription() {
    if (!pairingResult) {
      return;
    }
    try {
      await navigator.clipboard.writeText(pairingResult.subscriptionUrl);
      setCopied(true);
    } catch {
      setError("复制失败，请在系统设置中允许剪贴板访问后重试。");
    }
  }

  async function confirmRemoval() {
    if (!pendingRemoval) {
      return;
    }
    setError("");
    setRemoving(true);
    try {
      await onRevokeDevice(pendingRemoval.id);
      setPendingRemoval(null);
    } catch {
      setError("无法删除系统钥匙串中的订阅，请稍后重试。");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        actions={
          <Button
            icon={<Plus aria-hidden="true" size={16} />}
            onClick={() => setDialogOpen(true)}
            variant="primary"
          >
            添加设备
          </Button>
        }
        eyebrow="二维码和订阅不会上传"
        subtitle="为自己的设备复制订阅。每台设备建议使用独立凭据。"
        title="分享"
      />

      <section className="legacy-warning">
        <ShieldAlert aria-hidden="true" size={20} />
        <div>
          <strong>本机记录不等于服务端凭据隔离</strong>
          <p>当前基线实例仍共用节点身份；迁移完成前不要公开分享链接或二维码。</p>
        </div>
        <Badge tone="critical">高风险</Badge>
      </section>

      {devices.length === 0 ? (
        <section className="empty-state panel">
          <span>
            <Laptop aria-hidden="true" size={28} />
          </span>
          <h2>还没有设备记录</h2>
          <p>为每台 Mac 或 Windows 电脑创建单独记录，方便追踪和后续轮换。</p>
          <Button onClick={() => setDialogOpen(true)} variant="primary">
            添加第一台设备
          </Button>
        </section>
      ) : (
        <section className="device-grid">
          {devices.map((device) => (
            <article className="device-card" key={device.id}>
              <header>
                <span className="device-card__icon">
                  <Laptop aria-hidden="true" size={20} />
                </span>
                <Badge tone={device.status === "active" ? "positive" : "neutral"}>
                  {device.status === "active" ? "本机有效" : "已从本机移除"}
                </Badge>
              </header>
              <h2>{device.displayName}</h2>
              <p>创建于 {new Date(device.createdAt).toLocaleDateString("zh-CN")}</p>
              <div className="device-card__meta">
                <KeyRound aria-hidden="true" size={15} />
                <span>
                  {desktop ? "订阅保存在系统钥匙串" : "预览模式不保存订阅"}
                </span>
              </div>
              <footer>
                <Button
                  disabled={device.status !== "active"}
                  icon={<RotateCw aria-hidden="true" size={14} />}
                  onClick={() => setRotationDevice(device)}
                >
                  轮换步骤
                </Button>
                <button
                  aria-label={`从本机移除 ${device.displayName}`}
                  className="icon-button icon-button--danger"
                  disabled={device.status !== "active"}
                  onClick={() => setPendingRemoval(device)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={16} />
                </button>
              </footer>
            </article>
          ))}
        </section>
      )}

      <Dialog
        description="订阅只在创建时显示一次，桌面版会将其保存到系统钥匙串。"
        onClose={closeAddDialog}
        open={dialogOpen}
        title={pairingResult ? "设备订阅已就绪" : "添加设备记录"}
      >
        {pairingResult ? (
          <div className="pairing-result">
            <div className="pairing-result__success">
              <Check aria-hidden="true" size={18} />
              <span>{pairingResult.deviceName}</span>
            </div>
            <img
              alt={`${pairingResult.deviceName} 的一次性订阅二维码`}
              height="240"
              src={pairingResult.qrDataUrl}
              width="240"
            />
            <p>二维码等同访问凭证。导入客户端后关闭此窗口，不要发送给其他人。</p>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="form-actions">
              <Button
                icon={<Clipboard aria-hidden="true" size={15} />}
                onClick={() => void copySubscription()}
              >
                {copied ? "已复制" : "复制订阅"}
              </Button>
              <Button onClick={closeAddDialog} variant="primary">
                完成
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="setup-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createDevice();
            }}
          >
            <label className="field">
              <span>设备名称</span>
              <input
                autoComplete="off"
                onChange={(event) => setDeviceName(event.target.value)}
                placeholder="例如：我的 MacBook"
                value={deviceName}
              />
            </label>
            <label className="field">
              <span>现有 HTTPS 订阅地址</span>
              <input
                autoCapitalize="none"
                autoComplete="off"
                onChange={(event) => setSubscriptionUrl(event.target.value)}
                placeholder="内容只进入系统钥匙串"
                spellCheck={false}
                type="password"
                value={subscriptionUrl}
              />
              <small>不会写入工作区、日志或遥测。</small>
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="form-actions">
              <Button onClick={closeAddDialog}>取消</Button>
              <Button
                disabled={!deviceName.trim() || !subscriptionUrl.trim()}
                icon={<QrCode aria-hidden="true" size={16} />}
                type="submit"
                variant="primary"
              >
                生成二维码
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog
        description="这只会删除本机钥匙串中的订阅，不会修改远端服务器或其他设备。"
        onClose={() => {
          setError("");
          setPendingRemoval(null);
        }}
        open={Boolean(pendingRemoval)}
        title="从本机移除设备记录"
      >
        <div className="confirmation-content">
          <ShieldAlert aria-hidden="true" size={28} />
          <p>
            确定从这台电脑移除“{pendingRemoval?.displayName}”吗？远端订阅若已泄露，
            仍需在管理后台完成服务端轮换。
          </p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <Button disabled={removing} onClick={() => setPendingRemoval(null)}>
              取消
            </Button>
            <Button
              disabled={removing}
              onClick={() => void confirmRemoval()}
              variant="danger"
            >
              {removing ? "正在移除…" : "仅移除本机记录"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        description="当前版本不会把删除本机记录描述成服务端轮换。"
        onClose={() => setRotationDevice(null)}
        open={Boolean(rotationDevice)}
        title={`${rotationDevice?.displayName ?? "设备"}的安全轮换`}
      >
        <div className="rotation-guide">
          <ol>
            <li>先在对应管理后台生成新的独立订阅凭据。</li>
            <li>在客户端导入新订阅并完成连通性验证。</li>
            <li>回到 Glide 创建新的设备记录。</li>
            <li>确认新连接正常后，再撤销旧服务端凭据和本机记录。</li>
          </ol>
          <div className="review-warning">
            <ShieldAlert aria-hidden="true" size={18} />
            <p>只删除 Glide 中的记录不会让已经泄露的订阅失效。</p>
          </div>
          <div className="form-actions">
            <Button onClick={() => setRotationDevice(null)} variant="primary">
              我明白了
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
