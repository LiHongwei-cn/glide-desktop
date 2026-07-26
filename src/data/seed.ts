import type { AppState, ClientOption } from "@/domain/models";

const now = new Date().toISOString();

export const initialState: AppState = {
  connectionGroups: [
    {
      createdAt: now,
      displayName: "我的连接",
      healthScore: 0,
      id: "primary-connection-group",
      preferredRegion: "AUTO",
      routes: [],
      status: "draft",
      updatedAt: now,
    },
  ],
  devices: [],
  preferences: {
    diagnosticsRetentionDays: 7,
    reduceMotion: false,
    theme: "system",
  },
  recentDiagnostics: [],
  schemaVersion: 2,
  usage: {
    activeDays: [],
    firstOpenedAt: now,
    lastOpenedAt: now,
    launchCount: 0,
  },
};

export const clientOptions: ClientOption[] = [
  {
    architectures: ["x64", "ARM64"],
    id: "clash-verge-rev",
    license: "GPL-3.0",
    name: "Clash Verge Rev",
    officialUrl: "https://github.com/clash-verge-rev/clash-verge-rev/releases",
    operatingSystems: ["macOS", "Windows"],
    protocolSupport: ["Clash", "Mihomo"],
    summary: "适合需要图形界面与规则分流的桌面用户。",
  },
  {
    architectures: ["x64", "ARM64"],
    id: "v2rayn",
    license: "GPL-3.0",
    name: "v2rayN",
    officialUrl: "https://github.com/2dust/v2rayN/releases",
    operatingSystems: ["Windows"],
    protocolSupport: ["VLESS", "Trojan", "Xray"],
    summary: "Windows 上常用的开源客户端，支持直接导入订阅。",
  },
  {
    architectures: ["x64", "ARM64"],
    id: "hiddify",
    license: "GPL-3.0",
    name: "Hiddify",
    officialUrl: "https://github.com/hiddify/hiddify-app/releases",
    operatingSystems: ["macOS", "Windows"],
    protocolSupport: ["VLESS", "Clash", "sing-box"],
    summary: "跨平台客户端，适合作为 macOS 的简单导入路径。",
  },
];
