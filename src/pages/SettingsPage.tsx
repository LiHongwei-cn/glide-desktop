import {
  BarChart3,
  CalendarDays,
  EyeOff,
  HardDrive,
  KeyRound,
  Moon,
  MousePointerClick,
  ShieldCheck,
  Trash2,
  UserRound,
  WifiOff,
} from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Badge, Button, Dialog } from "@/components/ui";
import type { LocalUsageMetrics, Preferences, RuntimeInfo } from "@/domain/models";
import { getLocalUsageSummary } from "@/domain/usage";

interface SettingsPageProps {
  deviceCount: number;
  diagnosticCount: number;
  onClearDiagnostics: () => void;
  onResetUsage: () => void;
  onUpdatePreferences: (preferences: Partial<Preferences>) => void;
  preferences: Preferences;
  runtimeInfo: RuntimeInfo;
  usage: LocalUsageMetrics;
}

export function SettingsPage({
  deviceCount,
  diagnosticCount,
  onClearDiagnostics,
  onResetUsage,
  onUpdatePreferences,
  preferences,
  runtimeInfo,
  usage,
}: SettingsPageProps) {
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [resetUsageDialogOpen, setResetUsageDialogOpen] = useState(false);
  const usageSummary = getLocalUsageSummary(usage);

  return (
    <div className="page">
      <PageHeader
        eyebrow="无账号 · 无遥测 · 无云端档案"
        subtitle="密码进系统钥匙串，其余数据只保存在这台电脑。"
        title="设置"
      />

      <section className="settings-section panel">
        <header>
          <BarChart3 aria-hidden="true" size={20} />
          <div>
            <h2>本机使用统计</h2>
            <p>只统计这台电脑，不能代表 GitHub 上的全网用户数。</p>
          </div>
        </header>
        <div aria-label="本机使用统计" className="usage-grid">
          <UsageMetric
            icon={UserRound}
            label="本机用户档案"
            value={usageSummary.localProfileCount}
          />
          <UsageMetric
            icon={MousePointerClick}
            label="启动次数"
            value={usageSummary.launchCount}
          />
          <UsageMetric
            icon={CalendarDays}
            label="活跃天数"
            value={usageSummary.activeDayCount}
          />
          <UsageMetric
            icon={HardDrive}
            label="本机设备"
            value={deviceCount}
          />
        </div>
        <div className="settings-inline-note">
          <span>
            首次使用于 {new Date(usage.firstOpenedAt).toLocaleDateString("zh-CN")} ·
            已使用 {usageSummary.installDayCount} 天
          </span>
          <Button
            icon={<Trash2 aria-hidden="true" size={14} />}
            onClick={() => setResetUsageDialogOpen(true)}
          >
            重置统计
          </Button>
        </div>
      </section>

      <section className="settings-section panel">
        <header>
          <EyeOff aria-hidden="true" size={20} />
          <div>
            <h2>隐私保护</h2>
            <p>Glide 不建立远程用户档案，也不发送使用统计。</p>
          </div>
        </header>
        <PrivacyRow
          icon={WifiOff}
          label="遥测与用户追踪"
          status="关闭"
          text="不加载统计 SDK，不发送设备 ID、IP 或使用事件"
        />
        <PrivacyRow
          icon={KeyRound}
          label="密码与订阅"
          status="系统保护"
          text="只保存在 Keychain 或 Windows Credential Manager"
        />
        <PrivacyRow
          icon={HardDrive}
          label="线路与本机统计"
          status="仅本机"
          text="保存在应用数据目录，不同步到 Glide 服务器"
        />
        <p className="privacy-boundary">
          你主动运行检查时，Glide 只会访问你填写的管理地址；不会把结果发送给我们。
        </p>
      </section>

      <section className="settings-section panel">
        <header>
          <Moon aria-hidden="true" size={20} />
          <div>
            <h2>外观</h2>
            <p>跟随系统，也支持减少动态效果。</p>
          </div>
        </header>
        <label className="setting-row">
          <span>
            <strong>主题</strong>
            <small>切换后立即应用</small>
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
            <h2>本地数据</h2>
            <p>控制脱敏诊断的保留时间。</p>
          </div>
        </header>
        <label className="setting-row">
          <span>
            <strong>诊断保留</strong>
            <small>不包含订阅、密码和完整 URL</small>
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
            <strong>清除诊断</strong>
            <small>当前 {diagnosticCount} 次，只删除脱敏结果</small>
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

      <section className="settings-section panel">
        <header>
          <HardDrive aria-hidden="true" size={20} />
          <div>
            <h2>运行环境</h2>
            <p>桌面版启用钥匙串、SQLite 和本机网络检查。</p>
          </div>
        </header>
        <div className="runtime-grid">
          <div>
            <span>模式</span>
            <Badge tone={runtimeInfo.desktop ? "positive" : "warning"}>
              {runtimeInfo.desktop ? "桌面保护" : "浏览器预览"}
            </Badge>
          </div>
          <div>
            <span>系统</span>
            <strong>{runtimeInfo.operatingSystem}</strong>
          </div>
          <div>
            <span>架构</span>
            <strong>{runtimeInfo.architecture}</strong>
          </div>
          <div>
            <span>版本</span>
            <strong>{runtimeInfo.appVersion}</strong>
          </div>
        </div>
      </section>

      <section className="security-footer">
        <ShieldCheck aria-hidden="true" size={18} />
        <p>GitHub 发行版不包含后台地址、密码、订阅或任何本机使用数据。</p>
      </section>

      <Dialog
        description="不会删除线路、设备、系统钥匙串秘密或线上资源。"
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

      <Dialog
        description="只重置这台电脑上的启动次数和活跃天数。"
        onClose={() => setResetUsageDialogOpen(false)}
        open={resetUsageDialogOpen}
        title="重置本机使用统计"
      >
        <div className="confirmation-content">
          <BarChart3 aria-hidden="true" size={28} />
          <p>线路、设备、诊断和系统钥匙串内容不会受影响。</p>
          <div className="form-actions">
            <Button onClick={() => setResetUsageDialogOpen(false)}>取消</Button>
            <Button
              onClick={() => {
                onResetUsage();
                setResetUsageDialogOpen(false);
              }}
              variant="danger"
            >
              重置统计
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

function UsageMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UserRound;
  label: string;
  value: number;
}) {
  return (
    <div>
      <Icon aria-hidden="true" size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
