export type AppPage =
  | "overview"
  | "setup"
  | "routes"
  | "clients"
  | "diagnostics"
  | "settings";

export type ConnectionStatus = "active" | "degraded" | "draft" | "verifying";
export type CredentialState = "at-risk" | "healthy" | "rotating" | "unverified";
export type DiagnosticStatus = "failed" | "passed" | "pending" | "warning";
export type ManagementState = "connected" | "error" | "unverified";
export type RegionCode = "AUTO" | "HK" | "JP" | "SG" | "TW" | "US" | "UNKNOWN";
export type RegionVerification = "conflict" | "estimated" | "unverified" | "verified";
export type RouteSelectionMode = "automatic" | "manual";

export interface AdminInspection {
  adapter: "cmliu-edgetunnel";
  authenticated: boolean;
  configUpdatedAt?: string;
  credentialFingerprint: string;
  hostCount: number;
  nodePathFingerprint: string;
  preferenceMode: "custom" | "generator" | "random";
  preferredEndpointCount: number;
  protocol: string;
  responseTimeMs: number;
  skipCertificateVerification: boolean;
  specifiedPort?: number;
  subscriptionReady: boolean;
  transport: string;
  usageMax?: number;
  usageTotal?: number;
}

export interface AppState {
  connectionGroups: ConnectionGroup[];
  preferences: Preferences;
  recentDiagnostics: DiagnosticRun[];
  schemaVersion: number;
}

export interface ClientOption {
  architectures: string[];
  id: string;
  importNote: string;
  license: string;
  name: string;
  officialUrl: string;
  operatingSystems: string[];
  protocolSupport: string[];
  publisher: string;
  summary: string;
}

export interface CloudflareAccount {
  id: string;
  name: string;
}

export interface CloudflareAuthorization {
  accounts: CloudflareAccount[];
  credentialReference: string;
}

export interface CloudflareOAuthConfiguration {
  available: boolean;
  redirectUri: string;
  setupMessage: string;
}

export interface CloudflareOAuthStart {
  authorizationUrl: string;
  flowId: string;
}

export interface CloudflareDeploymentPlan {
  accountId: string;
  accountName: string;
  actions: DeploymentAction[];
  adminCredentialReference: string;
  authorizationReference: string;
  displayName: string;
  endpointPreview: string;
  kvTitle: string;
  planHash: string;
  scriptName: string;
  sourceCommit: string;
  sourceSha256: string;
  workersSubdomain: string;
}

export interface CloudflareDeploymentResult {
  adminEndpoint: string;
  credentialReference: string;
  inspection: AdminInspection;
  subscription: PreparedSubscription;
}

export interface CredentialVaultStatus {
  missingReferenceCount: number;
  ready: boolean;
}

export interface ConnectionGroup {
  createdAt: string;
  displayName: string;
  healthScore: number;
  id: string;
  preferredRegion: RegionCode;
  routes: RouteCandidate[];
  selectedRouteId?: string;
  selectionMode: RouteSelectionMode;
  selectionReason?: string;
  selectionUpdatedAt?: string;
  status: ConnectionStatus;
  updatedAt: string;
}

export interface CredentialRisk {
  affectedRouteIds: string[];
  code: "duplicate-node-credential" | "duplicate-node-path" | "shared-admin-secret";
  severity: "critical" | "high";
  title: string;
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

export interface DeploymentAction {
  action: "create" | "enable" | "reuse";
  label: string;
  resource: string;
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

export interface Preferences {
  diagnosticsRetentionDays: 7 | 14 | 30;
  reduceMotion: boolean;
  theme: "dark" | "light" | "system";
}

export interface PreparedSubscription {
  nodes: SubscriptionNode[];
  responseTimeMs: number;
  subscriptionUrl: string;
}

export interface PreparedSubscriptionNode {
  displayName: string;
  nodeUri: string;
  protocol: string;
  region: RegionCode;
  responseTimeMs: number;
}

export interface OptimizedRouteOption {
  nodes: SubscriptionNode[];
  routeId: string;
  routeName: string;
  stabilityDeltaMs: number;
  subscriptionUrl: string;
  verificationSamples: number;
  verifiedInMs: number;
}

export interface RegionEvidence {
  code: RegionCode;
  observedAt: string;
  source: string;
}

export interface RouteCandidate {
  adminAdapter?: AdminInspection["adapter"];
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
  lastManagedAt?: string;
  managementState?: ManagementState;
  nodePathGroupId: string;
  observedRegion: RegionCode;
  preferredIpCount: number;
  protocol: "VLESS";
  regionEvidence: RegionEvidence[];
  regionVerification: RegionVerification;
  status: ConnectionStatus;
  subscriptionReady?: boolean;
  transport: "WebSocket";
  version: string;
}

export interface RouteCheckUpdate {
  checkedAt: string;
  healthScore: number;
  routeIds: string[];
  status: Extract<ConnectionStatus, "active" | "degraded">;
}

export interface RouteOptimizationResult {
  availableCount: number;
  failedCount: number;
  nodes: SubscriptionNode[];
  reason: string;
  routeId: string;
  routeName?: string;
  routeOptions?: OptimizedRouteOption[];
  stabilityDeltaMs?: number;
  subscriptionUrl?: string;
  verificationSamples?: number;
  verifiedInMs?: number;
}

export interface RouteOptimizationProbe {
  inspection: AdminInspection;
  subscription: PreparedSubscription;
}

export interface RuntimeInfo {
  appVersion: string;
  architecture: string;
  desktop: boolean;
  operatingSystem: string;
}

export interface SubscriptionNode {
  displayName: string;
  id: string;
  latencyMs?: number;
  latencyStatus?: "reachable" | "timeout" | "unavailable";
  protocol: string;
  region: RegionCode;
}

export type WorkspacePersistenceStatus = "error" | "loading" | "saved" | "saving";
