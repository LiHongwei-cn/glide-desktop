import {
  EyeOff,
  HardDrive,
  KeyRound,
  Moon,
  ShieldCheck,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Badge, Button, Dialog } from "@/components/ui";
import type { Preferences, RuntimeInfo } from "@/domain/models";

interface SettingsPageProps {
  diagnosticCount: number;
  onClearDiagnostics: () => void;
  onUpdatePreferences: (preferences: Partial<Preferences>) => void;
  preferences: Preferences;
  runtimeInfo: RuntimeInfo;
}

export function SettingsPage({
  diagnosticCount,
  onClearDiagnostics,
  onUpdatePreferences,
  preferences,
  runtimeInfo,
}: SettingsPageProps) {
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  return (
    <div className="page page--compact">
      <PageHeader
        eyebrow="无账号 · 无遥测"
        subtitle="只保留真正影响使用与隐私的设置。"
        title="设置"
      />

      <section className="settings-section panel">
        <header>
          <EyeOff aria-hidden="true" size={20} />
          <div>
            <h2>本地隐私</h2>
            <p>你的线路、密码、订阅和使用记录不会上传到 Glide。</p>
          </div>
        </header>
        <PrivacyRow
          icon={WifiOff}
          label="遥测和用户追踪"
          status="关闭"
          text="不包含统计 SDK，不发送设备 ID、IP 或使用事件"
        />
        <PrivacyRow
          icon={KeyRound}
          label="后台管理密码"
          status="本机加密"
          text="保存在 Glide 专属加密目录；应用可直接读取，不再要求电脑密码"
        />
        <PrivacyRow
          icon={ShieldCheck}
          label="电脑登录密码"
          status="不需要"
          text="Glide 不读取、不记录，也不再通过系统凭据弹窗请求"
        />
      </section>

      <section className="settings-section panel">
        <header>
          <Moon aria-hidden="true" size={20} />
          <div>
            <h2>外观</h2>
            <p>更改后立即应用。</p>
          </div>
        </header>
        <label className="setting-row">
          <span>
            <strong>主题</strong>
            <small>默认跟随系统</small>
          </span>
          <select
            onChange={(event) =>
              onUpdatePreferences({
                theme: event.target.value as Preferences["theme"],
              })
            }
            value={preferences.theme}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
        <label className="setting-row">
          <span>
            <strong>减少动态效果</strong>
            <small>关闭非必要过渡动画</small>
          </span>
          <input
            checked={preferences.reduceMotion}
            onChange={(event) =>
              onUpdatePreferences({ reduceMotion: event.target.checked })
            }
            type="checkbox"
          />
        </label>
      </section>

      <section className="settings-section panel">
        <header>
          <HardDrive aria-hidden="true" size={20} />
          <div>
            <h2>本地诊断</h2>
            <p>只保存脱敏后的检查结果，不含完整地址、密码或订阅。</p>
          </div>
        </header>
        <label className="setting-row">
          <span>
            <strong>自动清理</strong>
            <small>到期后从本机删除</small>
          </span>
          <select
            onChange={(event) =>
              onUpdatePreferences({
                diagnosticsRetentionDays: Number(
                  event.target.value,
                ) as Preferences["diagnosticsRetentionDays"],
              })
            }
            value={preferences.diagnosticsRetentionDays}
          >
            <option value="7">7 天</option>
            <option value="14">14 天</option>
            <option value="30">30 天</option>
          </select>
        </label>
        <div className="setting-row">
          <span>
            <strong>清除全部诊断</strong>
            <small>当前 {diagnosticCount} 次</small>
          </span>
          <Button
            disabled={diagnosticCount === 0}
            icon={<Trash2 aria-hidden="true" size={14} />}
            onClick={() => setClearDialogOpen(true)}
          >
            清除
          </Button>
        </div>
      </section>

      <section className="runtime-strip" aria-label="运行环境">
        <span>{runtimeInfo.operatingSystem}</span>
        <span>{runtimeInfo.architecture}</span>
        <Badge tone={runtimeInfo.desktop ? "positive" : "warning"}>
          {runtimeInfo.desktop ? "本地保护已启用" : "浏览器预览"}
        </Badge>
        <span>v{runtimeInfo.appVersion.replace(/^v/, "")}</span>
      </section>

      <Dialog
        description="不会删除连接、凭据或线上资源。"
        onClose={() => setClearDialogOpen(false)}
        open={clearDialogOpen}
        title="清除本地诊断"
      >
        <div className="confirmation-content">
          <Trash2 aria-hidden="true" size={28} />
          <p>将永久删除这台电脑上的 {diagnosticCount} 次脱敏诊断结果。</p>
          <div className="form-actions">
            <Button onClick={() => setClearDialogOpen(false)}>取消</Button>
            <Button
              onClick={() => {
                onClearDiagnostics();
                setClearDialogOpen(false);
              }}
              variant="danger"
            >
              清除诊断
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function PrivacyRow({
  icon: Icon,
  label,
  status,
  text,
}: {
  icon: typeof EyeOff;
  label: string;
  status: string;
  text: string;
}) {
  return (
    <div className="privacy-row">
      <Icon aria-hidden="true" size={18} />
      <span>
        <strong>{label}</strong>
        <small>{text}</small>
      </span>
      <Badge tone="positive">{status}</Badge>
    </div>
  );
}
