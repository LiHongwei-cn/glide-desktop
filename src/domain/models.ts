export type AppPage =
  | "overview"
  | "setup"
  | "routes"
  | "subscriptions"
  | "clients"
  | "diagnostics"
  | "settings";

export type ConnectionStatus = "active" | "degraded" | "draft" | "verifying";
export type CredentialState = "at-risk" | "healthy" | "rotating" | "unverified";
export type DeviceStatus = "active" | "revoked";
export type DiagnosticStatus = "failed" | "passed" | "pending" | "warning";
export type RegionCode = "AUTO" | "HK" | "JP" | "SG" | "TW" | "US" | "UNKNOWN";
export type RegionVerification = "conflict" | "estimated" | "unverified" | "verified";

export interface AppState {
  connectionGroups: ConnectionGroup[];
  devices: DeviceCredential[];
  preferences: Preferences;
  recentDiagnostics: DiagnosticRun[];
  schemaVersion: number;
  usage: LocalUsageMetrics;
}

export interface ClientOption {
  architectures: string[];
  id: string;
  license: string;
  name: string;
  officialUrl: string;
  operatingSystems: string[];
  protocolSupport: string[];
  publisher: string;
  summary: string;
}

export interface ConnectionGroup {
  createdAt: string;
  displayName: string;
  healthScore: number;
  id: string;
  preferredRegion: RegionCode;
  routes: RouteCandidate[];
  status: ConnectionStatus;
  updatedAt: string;
}

export interface CredentialRisk {
  affectedRouteIds: string[];
  code: "duplicate-node-credential" | "duplicate-node-path" | "shared-admin-secret";
  severity: "critical" | "high";
  title: string;
}

export interface DeviceCredential {
  createdAt: string;
  credentialReference: string;
  displayName: string;
  id: string;
  lastUsedAt?: string;
  status: DeviceStatus;
}

export interface DiagnosticCheck {
  detail: string;
  durationMs?: number;
  id: string;
  label: string;
  status: DiagnosticStatus;
}

export interface DiagnosticRun {
  checks: DiagnosticCheck[];
  completedAt?: string;
  id: string;
  startedAt: string;
}

export interface EndpointProbe {
  detail: string;
  durationMs?: number;
  endpoint: string;
  status: DiagnosticStatus;
}

export interface HealthSample {
  connectionSuccess: number;
  jitterScore: number;
  latencyScore: number;
  regionConfidence: number;
  sessionSurvival: number;
  targetReachability: number;
  throughputScore: number;
}

export interface LegacyImportDraft {
  adminUrl: string;
  displayName: string;
  password: string;
  configuredRegion: RegionCode;
}

export interface LocalUsageMetrics {
  activeDays: string[];
  firstOpenedAt: string;
  lastOpenedAt: string;
  launchCount: number;
}

export interface Preferences {
  diagnosticsRetentionDays: 7 | 14 | 30;
  reduceMotion: boolean;
  theme: "dark" | "light" | "system";
}

export interface RegionEvidence {
  code: RegionCode;
  observedAt: string;
  source: string;
}

export interface RouteCandidate {
  adminEndpoint?: string;
  configuredRegion: RegionCode;
  credentialReference?: string;
  credentialGroupId: string;
  credentialState: CredentialState;
  displayName: string;
  endpointLabel: string;
  healthScore: number;
  id: string;
  lastCheckedAt?: string;
  nodePathGroupId: string;
  observedRegion: RegionCode;
  preferredIpCount: number;
  protocol: "VLESS";
  regionEvidence: RegionEvidence[];
  regionVerification: RegionVerification;
  status: ConnectionStatus;
  transport: "WebSocket";
  version: string;
}

export interface RouteCheckUpdate {
  checkedAt: string;
  healthScore: number;
  routeIds: string[];
  status: Extract<ConnectionStatus, "active" | "degraded">;
}

export interface RuntimeInfo {
  appVersion: string;
  architecture: string;
  desktop: boolean;
  operatingSystem: string;
}

export type WorkspacePersistenceStatus = "error" | "loading" | "saved" | "saving";
