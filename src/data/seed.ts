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
      selectionMode: "automatic",
      status: "draft",
      updatedAt: now,
    },
  ],
  preferences: {
    diagnosticsRetentionDays: 7,
    reduceMotion: false,
    theme: "system",
  },
  recentDiagnostics: [],
  schemaVersion: 4,
};

export const clientOptions: ClientOption[] = [
  {
    architectures: ["x64", "ARM64"],
    id: "clash-verge-rev",
    importNote: "当前隐私订阅不直接转换为 Clash YAML，暂作高级备用。",
    license: "GPL-3.0",
    name: "Clash Verge Rev",
    officialUrl: "https://github.com/clash-verge-rev/clash-verge-rev/releases",
    operatingSystems: ["macOS", "Windows"],
    protocolSupport: ["Clash", "Mihomo"],
    publisher: "clash-verge-rev",
    summary: "适合需要图形界面与规则分流的桌面用户。",
  },
  {
    architectures: ["x64", "ARM64"],
    id: "v2rayn",
    importNote: "可直接导入 Glide 生成的隐私订阅。",
    license: "GPL-3.0",
    name: "v2rayN",
    officialUrl: "https://github.com/2dust/v2rayN/releases",
    operatingSystems: ["Windows"],
    protocolSupport: ["VLESS", "Trojan", "Xray"],
    publisher: "2dust",
    summary: "Windows 上常用的开源客户端，支持直接导入订阅。",
  },
  {
    architectures: ["x64", "ARM64"],
    id: "hiddify",
    importNote: "可直接导入 Glide 生成的隐私订阅。",
    license: "GPL-3.0",
    name: "Hiddify",
    officialUrl: "https://github.com/hiddify/hiddify-app/releases",
    operatingSystems: ["macOS", "Windows"],
    protocolSupport: ["VLESS", "Clash", "sing-box"],
    publisher: "hiddify",
    summary: "跨平台客户端，适合作为 macOS 的简单导入路径。",
  },
];
