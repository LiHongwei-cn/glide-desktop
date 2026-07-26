import {
  Activity,
  AppWindow,
  CircleGauge,
  CloudCog,
  Download,
  LayoutDashboard,
  Network,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import type {
  AppPage,
  RuntimeInfo,
  WorkspacePersistenceStatus,
} from "@/domain/models";

interface AppShellProps {
  activePage: AppPage;
  children: ReactNode;
  onNavigate: (page: AppPage) => void;
  persistenceStatus: WorkspacePersistenceStatus;
  runtimeInfo: RuntimeInfo;
}

interface NavigationItem {
  icon: LucideIcon;
  id: AppPage;
  label: string;
}

const primaryNavigation: NavigationItem[] = [
  { icon: LayoutDashboard, id: "overview", label: "首页" },
  { icon: CloudCog, id: "setup", label: "添加连接" },
  { icon: Network, id: "routes", label: "线路" },
  { icon: AppWindow, id: "subscriptions", label: "分享" },
  { icon: Activity, id: "diagnostics", label: "检查" },
];

const secondaryNavigation: NavigationItem[] = [
  { icon: Download, id: "clients", label: "客户端" },
  { icon: Settings, id: "settings", label: "设置" },
];

export function AppShell({
  activePage,
  children,
  onNavigate,
  persistenceStatus,
  runtimeInfo,
}: AppShellProps) {
  const mainContentReference = useRef<HTMLElement>(null);

  useEffect(() => {
    const heading = mainContentReference.current?.querySelector("h1");
    if (!(heading instanceof HTMLElement)) {
      return;
    }
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [activePage]);

  const persistenceLabel = {
    error: "本地保存失败",
    loading: "正在读取本地数据",
    saved: runtimeInfo.desktop ? "本地数据已保护" : "预览数据已保存",
    saving: "正在保存",
  }[persistenceStatus];

  return (
    <div className="app-window">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="titlebar">
        <div aria-hidden="true" className="titlebar__spacer" />
        <div className="titlebar__brand">
          <ShieldCheck aria-hidden="true" size={16} />
          <span>Glide</span>
        </div>
        <div className="titlebar__runtime">
          <span
            className={`status-dot status-dot--${
              persistenceStatus === "error"
                ? "failed"
                : persistenceStatus === "saved"
                  ? "passed"
                  : "pending"
            }`}
          />
          <span aria-live="polite">{persistenceLabel}</span>
        </div>
      </header>
      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar__brand">
            <div className="brand-mark">
              <CircleGauge aria-hidden="true" size={22} />
            </div>
            <div>
              <strong>Glide</strong>
              <span>连接更简单</span>
            </div>
          </div>
          <nav aria-label="主要导航" className="sidebar__nav">
            {primaryNavigation.map((item) => (
              <NavigationButton
                active={activePage === item.id}
                item={item}
                key={item.id}
                onNavigate={onNavigate}
              />
            ))}
          </nav>
          <nav aria-label="设置导航" className="sidebar__nav sidebar__nav--bottom">
            {secondaryNavigation.map((item) => (
              <NavigationButton
                active={activePage === item.id}
                item={item}
                key={item.id}
                onNavigate={onNavigate}
              />
            ))}
          </nav>
          <div className="sidebar__footer">
            <span>{runtimeInfo.operatingSystem}</span>
            <span>v{runtimeInfo.appVersion.replace(/^v/, "")}</span>
          </div>
        </aside>
        <main className="main-content" id="main-content" ref={mainContentReference}>
          {children}
        </main>
      </div>
    </div>
  );
}

function NavigationButton({
  active,
  item,
  onNavigate,
}: {
  active: boolean;
  item: NavigationItem;
  onNavigate: (page: AppPage) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`nav-item${active ? " nav-item--active" : ""}`}
      onClick={() => onNavigate(item.id)}
      type="button"
    >
      <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
      <span>{item.label}</span>
    </button>
  );
}
