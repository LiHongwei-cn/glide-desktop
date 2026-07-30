import {
  Check,
  Clipboard,
  Download,
  Gauge,
  KeyRound,
  LockKeyhole,
  MapPin,
  MousePointer2,
  QrCode,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useId, useMemo, useState } from "react";

import { Badge, Button, Dialog } from "@/components/ui";
import { CredentialSetupRequiredError } from "@/domain/errors";
import { getRegionName } from "@/domain/health";
import type {
  ConnectionGroup,
  OptimizedRouteOption,
  PreparedSubscriptionNode,
  PreparedSubscription,
  RegionCode,
  RouteOptimizationResult,
  SubscriptionNode,
} from "@/domain/models";
import {
  maximumSecretLength,
  validateSecretInput,
} from "@/domain/validation";
import { userFacingDesktopError } from "@/services/desktop";

type Route = ConnectionGroup["routes"][number];

interface LineSubscriptionResult {
  routeName: string;
  stabilityDeltaMs?: number;
  subscriptionUrl: string;
  verificationSamples?: number;
  verifiedInMs: number;
}

interface NodeSubscriptionResult {
  nodeName: string;
  nodeUri: string;
  verifiedInMs: number;
}

type ExportKind = "line" | "node";

interface QrPayload {
  dataUrl: string;
  kind: ExportKind;
  label: string;
}

export function LineSelectionPanel({
  group,
  onOpenClients,
  onOptimize,
  onPrepare,
  onPrepareNode,
  onSaveCredential,
  onSelect,
  onSelectRegion,
}: {
  group: ConnectionGroup;
  onOpenClients: () => void;
  onOptimize: () => Promise<RouteOptimizationResult>;
  onPrepare: (routeId: string) => Promise<PreparedSubscription>;
  onPrepareNode: (
    routeId: string,
    nodeId: string,
  ) => Promise<PreparedSubscriptionNode>;
  onSaveCredential: (secret: string) => Promise<void>;
  onSelect: (routeId: string) => void;
  onSelectRegion: (region: RegionCode) => void;
}) {
  const controller = useLineSelectionController({
    group,
    onOptimize,
    onPrepare,
    onPrepareNode,
    onSaveCredential,
    onSelect,
    onSelectRegion,
  });
  const selectedRoute = group.routes.find(
    (route) => route.id === controller.activeRouteId,
  );
  const recommendedRoute = useMemo(
    () =>
      [...group.routes]
        .filter(isSelectable)
        .sort(
          (routeA, routeB) =>
            getRecommendationScore(routeB) - getRecommendationScore(routeA) ||
            routeA.displayName.localeCompare(routeB.displayName),
        )[0],
    [group.routes],
  );

  return (
    <>
      <section aria-labelledby="node-selection-heading" className="node-selection panel">
        <SelectionHeader group={group} />
        <CurrentSelection group={group} route={selectedRoute} />
        <SelectionActions
          disabled={group.routes.length === 0}
          onOpen={controller.openPicker}
          onOptimize={controller.optimize}
          optimizing={controller.optimizing}
        />
        <SelectionFeedback feedback={controller.feedback} />
        <TargetNodeSelection
          availableNodes={controller.availableNodes}
          nodes={controller.lineNodes}
          onPrepare={controller.selectNode}
          onRetest={controller.retestLatency}
          onSelectRegion={controller.selectRegion}
          preparingNodeId={controller.preparingNodeId}
          region={controller.region}
          route={selectedRoute}
          testingLatency={controller.testingLatency}
        />
        {controller.lineSubscription ? (
          <SubscriptionReady
            copied={controller.copied}
            onClearClipboard={controller.clearClipboard}
            onCopy={controller.copySubscription}
            onOpenClients={onOpenClients}
            onShowQr={controller.showQr}
            lineResult={controller.lineSubscription}
            nodeResult={controller.nodeSubscription}
          />
        ) : null}
      </section>

      <LinePickerDialog
        group={group}
        onClose={controller.closePicker}
        onSelect={controller.selectRoute}
        open={controller.pickerOpen}
        preparingRouteId={controller.preparingRouteId}
        recommendedRoute={recommendedRoute}
        selectedRoute={selectedRoute}
      />

      <CredentialSetupDialog
        error={controller.credentialError}
        onClose={controller.closeCredentialSetup}
        onSave={controller.saveCredential}
        open={controller.credentialSetupOpen}
        saving={controller.savingCredential}
      />

      <Dialog
        description="二维码等同订阅凭证，只在这台电脑上临时生成。"
        onClose={controller.closeQr}
        open={Boolean(controller.qrPayload)}
        title={
          controller.qrPayload?.kind === "node"
            ? "扫描当前节点二维码"
            : "扫描整条订阅二维码"
        }
      >
        <div className="subscription-qr">
          {controller.qrPayload ? (
            <img
              alt={`${controller.qrPayload.label}的导入二维码`}
              height="260"
              src={controller.qrPayload.dataUrl}
              width="260"
            />
          ) : null}
          <p>
            {controller.qrPayload?.kind === "node"
              ? "这只导入当前节点。需要整组节点时，请关闭后选择“订阅二维码”。"
              : "这会导入整条线路订阅及其全部节点。不要把二维码发送给其他人。"}
          </p>
          <Button onClick={controller.closeQr} variant="primary">
            完成
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function useLineSelectionController({
  group,
  onOptimize,
  onPrepare,
  onPrepareNode,
  onSaveCredential,
  onSelect,
  onSelectRegion,
}: {
  group: ConnectionGroup;
  onOptimize: () => Promise<RouteOptimizationResult>;
  onPrepare: (routeId: string) => Promise<PreparedSubscription>;
  onPrepareNode: (
    routeId: string,
    nodeId: string,
  ) => Promise<PreparedSubscriptionNode>;
  onSaveCredential: (secret: string) => Promise<void>;
  onSelect: (routeId: string) => void;
  onSelectRegion: (region: RegionCode) => void;
}) {
  const [activeRouteId, setActiveRouteId] = useState(group.selectedRouteId ?? "");
  const [copied, setCopied] = useState<ExportKind | null>(null);
  const [credentialError, setCredentialError] = useState("");
  const [credentialSetupOpen, setCredentialSetupOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [lineSubscription, setLineSubscription] =
    useState<LineSubscriptionResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lineNodes, setLineNodes] = useState<SubscriptionNode[]>([]);
  const [nodeSubscription, setNodeSubscription] =
    useState<NodeSubscriptionResult | null>(null);
  const [preparingNodeId, setPreparingNodeId] = useState("");
  const [preparingRouteId, setPreparingRouteId] = useState("");
  const [qrPayload, setQrPayload] = useState<QrPayload | null>(null);
  const [region, setRegion] = useState<RegionCode>(group.preferredRegion);
  const [routeOptions, setRouteOptions] = useState<OptimizedRouteOption[]>([]);
  const [savingCredential, setSavingCredential] = useState(false);
  const [testingLatency, setTestingLatency] = useState(false);

  useEffect(() => {
    if (group.selectedRouteId) {
      setActiveRouteId(group.selectedRouteId);
    }
  }, [group.selectedRouteId]);

  async function optimize() {
    setCopied(null);
    setFeedback("");
    setLineSubscription(null);
    setNodeSubscription(null);
    setOptimizing(true);
    try {
      const result = await onOptimize();
      if (!result.subscriptionUrl || !result.routeName) {
        throw new Error("优化没有生成可导入订阅，请重新运行。");
      }
      const optimizedOptions =
        result.routeOptions?.length
          ? result.routeOptions
          : [
              {
                nodes: result.nodes,
                routeId: result.routeId,
                routeName: result.routeName,
                stabilityDeltaMs: result.stabilityDeltaMs ?? 0,
                subscriptionUrl: result.subscriptionUrl,
                verificationSamples: result.verificationSamples ?? 1,
                verifiedInMs: result.verifiedInMs ?? 0,
              },
            ];
      setActiveRouteId(result.routeId);
      setLineNodes(result.nodes);
      setRouteOptions(optimizedOptions);
      setRegion(
        availableRegionPreference(
          optimizedOptions.flatMap((option) => option.nodes),
          group.preferredRegion,
        ),
      );
      setLineSubscription({
        routeName: result.routeName,
        stabilityDeltaMs: result.stabilityDeltaMs,
        subscriptionUrl: result.subscriptionUrl,
        verificationSamples: result.verificationSamples,
        verifiedInMs: result.verifiedInMs ?? 0,
      });
      setFeedback(
        `${formatOptimizationFeedback(result)} 已发现 ${result.nodes.length} 个节点，请继续按标签选择。`,
      );
    } catch (error) {
      if (error instanceof CredentialSetupRequiredError) {
        setCredentialSetupOpen(true);
        setFeedback("首次升级需要保存一次后台管理密码。");
      } else {
        setFeedback(userFacingDesktopError(error, "优化失败，请稍后重试。"));
      }
    } finally {
      setOptimizing(false);
    }
  }

  async function selectRoute(routeId: string) {
    const route = group.routes.find((candidate) => candidate.id === routeId);
    if (!route) {
      return;
    }
    setFeedback("");
    setPreparingRouteId(routeId);
    try {
      const prepared = await onPrepare(routeId);
      onSelect(routeId);
      setActiveRouteId(routeId);
      setCopied(null);
      setLineNodes(prepared.nodes);
      setNodeSubscription(null);
      setRouteOptions([
        {
          nodes: prepared.nodes,
          routeId,
          routeName: route.displayName,
          stabilityDeltaMs: 0,
          subscriptionUrl: prepared.subscriptionUrl,
          verificationSamples: 1,
          verifiedInMs: prepared.responseTimeMs,
        },
      ]);
      setRegion(availableRegionPreference(prepared.nodes, group.preferredRegion));
      setLineSubscription({
        routeName: route.displayName,
        subscriptionUrl: prepared.subscriptionUrl,
        verifiedInMs: prepared.responseTimeMs,
      });
      setFeedback(
        `已验证线路 ${route.displayName}，发现 ${prepared.nodes.length} 个节点，请继续按标签选择。`,
      );
      setPickerOpen(false);
    } catch (error) {
      if (error instanceof CredentialSetupRequiredError) {
        setPickerOpen(false);
        setCredentialSetupOpen(true);
      } else {
        setFeedback(userFacingDesktopError(error, "这个节点暂时无法生成订阅。"));
        setPickerOpen(false);
      }
    } finally {
      setPreparingRouteId("");
    }
  }

  async function selectNode(nodeId: string) {
    if (!activeRouteId) {
      return;
    }
    const route = group.routes.find((candidate) => candidate.id === activeRouteId);
    if (!route) {
      return;
    }
    setCopied(null);
    setFeedback("");
    setPreparingNodeId(nodeId);
    try {
      const prepared = await onPrepareNode(activeRouteId, nodeId);
      setNodeSubscription({
        nodeName: `${route.displayName} · ${prepared.displayName}`,
        nodeUri: prepared.nodeUri,
        verifiedInMs: prepared.responseTimeMs,
      });
      setFeedback(
        `已确认 ${prepared.displayName}。整条订阅仍保留，可分别复制订阅或当前节点。`,
      );
    } catch (error) {
      setFeedback(userFacingDesktopError(error, "这个节点已变化，请重新选择线路。"));
    } finally {
      setPreparingNodeId("");
    }
  }

  async function retestLatency() {
    if (!activeRouteId) {
      return;
    }
    const route = group.routes.find((candidate) => candidate.id === activeRouteId);
    if (!route) {
      return;
    }
    setFeedback("");
    setTestingLatency(true);
    try {
      const prepared = await onPrepare(activeRouteId);
      const reachableCount = prepared.nodes.filter(
        (node) => node.latencyStatus === "reachable",
      ).length;
      setLineNodes(prepared.nodes);
      setNodeSubscription(null);
      setRouteOptions((currentOptions) => {
        const nextOption = {
          nodes: prepared.nodes,
          routeId: activeRouteId,
          routeName: route.displayName,
          stabilityDeltaMs: 0,
          subscriptionUrl: prepared.subscriptionUrl,
          verificationSamples: 1,
          verifiedInMs: prepared.responseTimeMs,
        };
        if (!currentOptions.some((option) => option.routeId === activeRouteId)) {
          return [nextOption];
        }
        return currentOptions.map((option) =>
          option.routeId === activeRouteId ? nextOption : option,
        );
      });
      setLineSubscription((currentResult) => ({
        routeName: route.displayName,
        stabilityDeltaMs: currentResult?.stabilityDeltaMs,
        subscriptionUrl: prepared.subscriptionUrl,
        verificationSamples: currentResult?.verificationSamples,
        verifiedInMs: prepared.responseTimeMs,
      }));
      setFeedback(
        reachableCount > 0
          ? `节点测速完成：${reachableCount}/${prepared.nodes.length} 个入口取得三次握手中位数。`
          : "节点测速完成，但当前网络未能连接这些公网入口；请关闭失效线路或稍后重试。",
      );
    } catch (error) {
      if (error instanceof CredentialSetupRequiredError) {
        setCredentialSetupOpen(true);
        setFeedback("首次升级需要保存一次后台管理密码。");
      } else {
        setFeedback(userFacingDesktopError(error, "节点测速失败，请稍后重试。"));
      }
    } finally {
      setTestingLatency(false);
    }
  }

  async function saveCredential(secret: string) {
    setCredentialError("");
    setSavingCredential(true);
    try {
      validateSecretInput(secret, "后台管理密码");
      await onSaveCredential(secret);
      setCredentialSetupOpen(false);
      setFeedback("密码已保存到 Glide 本机加密目录，后续不会再要求电脑密码。");
      await optimize();
    } catch (error) {
      setCredentialError(
        userFacingDesktopError(error, "密码验证失败，请确认所有连接使用同一密码。"),
      );
    } finally {
      setSavingCredential(false);
    }
  }

  async function copySubscription(kind: ExportKind) {
    const payload =
      kind === "line" ? lineSubscription?.subscriptionUrl : nodeSubscription?.nodeUri;
    if (!payload) {
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(kind);
      setFeedback(
        kind === "node"
          ? "节点已复制。现在到客户端中选择“从剪贴板导入”。"
          : "整条订阅已复制，会导入该线路的全部节点。",
      );
    } catch {
      setFeedback("复制失败，请在系统设置中允许 Glide 使用剪贴板。");
    }
  }

  async function clearClipboard() {
    try {
      await navigator.clipboard.writeText("");
      setCopied(null);
      setFeedback("剪贴板已清空。");
    } catch {
      setFeedback("无法清空剪贴板，请复制一段普通文字覆盖订阅。");
    }
  }

  async function showQr(kind: ExportKind) {
    const payload =
      kind === "line" ? lineSubscription?.subscriptionUrl : nodeSubscription?.nodeUri;
    const label =
      kind === "line" ? lineSubscription?.routeName : nodeSubscription?.nodeName;
    if (!payload || !label) {
      return;
    }
    try {
      setQrPayload({
        dataUrl: await QRCode.toDataURL(payload, {
          color: { dark: "#151518", light: "#ffffff" },
          errorCorrectionLevel: "M",
          margin: 2,
          width: 260,
        }),
        kind,
        label,
      });
    } catch {
      setFeedback("无法生成二维码，请改用复制订阅。");
    }
  }

  const availableNodes =
    routeOptions.length > 0
      ? routeOptions.flatMap((option) => option.nodes)
      : lineNodes;

  function selectRegion(nextRegion: RegionCode) {
    setRegion(nextRegion);
    onSelectRegion(nextRegion);
    if (nextRegion === "AUTO") {
      return;
    }
    const bestOption = routeOptions.find((option) =>
      option.nodes.some((node) => node.region === nextRegion),
    );
    if (!bestOption || bestOption.routeId === activeRouteId) {
      return;
    }
    onSelect(bestOption.routeId);
    setActiveRouteId(bestOption.routeId);
    setCopied(null);
    setLineNodes(bestOption.nodes);
    setLineSubscription({
      routeName: bestOption.routeName,
      stabilityDeltaMs: bestOption.stabilityDeltaMs,
      subscriptionUrl: bestOption.subscriptionUrl,
      verificationSamples: bestOption.verificationSamples,
      verifiedInMs: bestOption.verifiedInMs,
    });
    setNodeSubscription(null);
    setFeedback(
      `已切换到含${getRegionName(nextRegion)}标签且本轮响应最优的 ${
        bestOption.routeName
      }。`,
    );
  }

  return {
    activeRouteId,
    availableNodes,
    clearClipboard: () => void clearClipboard(),
    closeCredentialSetup: () => {
      if (!savingCredential) {
        setCredentialError("");
        setCredentialSetupOpen(false);
      }
    },
    closePicker: () => {
      if (!preparingRouteId) {
        setPickerOpen(false);
      }
    },
    closeQr: () => setQrPayload(null),
    copied,
    copySubscription: (kind: ExportKind) => void copySubscription(kind),
    credentialError,
    credentialSetupOpen,
    feedback,
    lineSubscription,
    lineNodes,
    nodeSubscription,
    openPicker: () => {
      setFeedback("");
      setPickerOpen(true);
    },
    optimize: () => void optimize(),
    optimizing,
    pickerOpen,
    preparingNodeId,
    preparingRouteId,
    qrPayload,
    retestLatency: () => void retestLatency(),
    saveCredential,
    savingCredential,
    selectNode: (nodeId: string) => void selectNode(nodeId),
    selectRegion,
    selectRoute: (routeId: string) => void selectRoute(routeId),
    showQr: (kind: ExportKind) => void showQr(kind),
    testingLatency,
    region,
  };
}

function SelectionHeader({ group }: { group: ConnectionGroup }) {
  return (
    <div className="node-selection__header">
      <span className="node-selection__icon">
        <Sparkles aria-hidden="true" size={20} />
      </span>
      <div>
        <h2 id="node-selection-heading">选择线路与目标节点</h2>
        <p>先验证线路，再按订阅标签选择节点；标签不代表真实出口。</p>
      </div>
      <Badge tone={group.selectionMode === "manual" ? "info" : "positive"}>
        {group.selectionMode === "manual" ? "手动选择" : "自动选择"}
      </Badge>
    </div>
  );
}

function CurrentSelection({
  group,
  route,
}: {
  group: ConnectionGroup;
  route?: Route;
}) {
  return (
    <div className="node-selection__current">
      <div>
        <span>当前线路</span>
        <strong>{route?.displayName ?? "尚未选择"}</strong>
        <p>
          {group.selectionReason ??
            (group.routes.length > 0
              ? "点击一键优化线路，Glide 会复测后选择稳定入口。"
              : "先添加至少一条连接。")}
        </p>
      </div>
      {route ? (
        <div aria-label="当前线路摘要" className="node-selection__facts">
          <span>
            <Gauge aria-hidden="true" size={14} />
            {route.healthScore}
          </span>
          <span>
            <MapPin aria-hidden="true" size={14} />
            {getRegionName(route.configuredRegion)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function SelectionActions({
  disabled,
  onOpen,
  onOptimize,
  optimizing,
}: {
  disabled: boolean;
  onOpen: () => void;
  onOptimize: () => void;
  optimizing: boolean;
}) {
  return (
    <div className="node-selection__actions">
      <Button
        disabled={optimizing || disabled}
        icon={<Sparkles aria-hidden="true" size={17} />}
        onClick={onOptimize}
        variant="primary"
      >
        {optimizing ? "正在复测线路与订阅…" : "一键优化线路"}
      </Button>
      <Button
        disabled={optimizing || disabled}
        icon={<MousePointer2 aria-hidden="true" size={17} />}
        onClick={onOpen}
      >
        自己选线路
      </Button>
      <span>
        <LockKeyhole aria-hidden="true" size={14} />
        只读，不修改服务器
      </span>
    </div>
  );
}

function SelectionFeedback({ feedback }: { feedback: string }) {
  if (!feedback) {
    return null;
  }
  const isError = ["失败", "无法", "未能", "没有"].some((keyword) =>
    feedback.includes(keyword),
  );
  return (
    <p className="node-selection__feedback" role={isError ? "alert" : "status"}>
      {feedback}
    </p>
  );
}

function SubscriptionReady({
  copied,
  lineResult,
  nodeResult,
  onClearClipboard,
  onCopy,
  onOpenClients,
  onShowQr,
}: {
  copied: ExportKind | null;
  lineResult: LineSubscriptionResult;
  nodeResult: NodeSubscriptionResult | null;
  onClearClipboard: () => void;
  onCopy: (kind: ExportKind) => void;
  onOpenClients: () => void;
  onShowQr: (kind: ExportKind) => void;
}) {
  return (
    <div className="subscription-ready">
      <span className="subscription-ready__mark">
        <Check aria-hidden="true" size={20} />
      </span>
      <div className="subscription-ready__content">
        <Badge tone="positive">线路订阅已验证</Badge>
        <h3>{lineResult.routeName}</h3>
        <p>{formatVerificationSummary(lineResult)}</p>
        {nodeResult ? (
          <div className="subscription-ready__node">
            <span>当前节点</span>
            <strong>{nodeResult.nodeName}</strong>
            <small>
              已从最新订阅重新确认
              {nodeResult.verifiedInMs > 0
                ? `，读取用时 ${nodeResult.verifiedInMs} ms`
                : ""}
            </small>
          </div>
        ) : null}
        <div className="subscription-ready__actions">
          <Button
            icon={<Clipboard aria-hidden="true" size={15} />}
            onClick={() => onCopy("line")}
            variant="primary"
          >
            {copied === "line" ? "订阅已复制" : "复制整条订阅"}
          </Button>
          <Button
            icon={<QrCode aria-hidden="true" size={15} />}
            onClick={() => onShowQr("line")}
          >
            订阅二维码
          </Button>
          {nodeResult ? (
            <>
              <Button
                icon={<Clipboard aria-hidden="true" size={15} />}
                onClick={() => onCopy("node")}
              >
                {copied === "node" ? "节点已复制" : "复制当前节点"}
              </Button>
              <Button
                icon={<QrCode aria-hidden="true" size={15} />}
                onClick={() => onShowQr("node")}
              >
                节点二维码
              </Button>
            </>
          ) : null}
          <Button icon={<Download aria-hidden="true" size={15} />} onClick={onOpenClients}>
            下载客户端
          </Button>
          {copied !== null ? (
            <Button
              icon={<Trash2 aria-hidden="true" size={15} />}
              onClick={onClearClipboard}
              variant="tertiary"
            >
              清空剪贴板
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LinePickerDialog({
  group,
  onClose,
  onSelect,
  open,
  preparingRouteId,
  recommendedRoute,
  selectedRoute,
}: {
  group: ConnectionGroup;
  onClose: () => void;
  onSelect: (routeId: string) => void;
  open: boolean;
  preparingRouteId: string;
  recommendedRoute?: Route;
  selectedRoute?: Route;
}) {
  return (
    <Dialog
      description="点击后会验证线路后台和真实订阅，再加载该线路中的节点。"
      onClose={onClose}
      open={open}
      title="自己选线路"
    >
      <div className="node-picker">
        <div aria-label="可选线路" className="node-picker__list" role="group">
          {[...group.routes]
            .sort(
              (routeA, routeB) =>
                routeB.healthScore - routeA.healthScore ||
                routeA.displayName.localeCompare(routeB.displayName),
            )
            .map((route) => (
              <LinePickerOption
                busy={preparingRouteId === route.id}
                disabled={Boolean(preparingRouteId)}
                key={route.id}
                onSelect={onSelect}
                recommended={route.id === recommendedRoute?.id}
                route={route}
                selected={route.id === selectedRoute?.id}
              />
            ))}
        </div>
      </div>
    </Dialog>
  );
}

function LinePickerOption({
  busy,
  disabled,
  onSelect,
  recommended,
  route,
  selected,
}: {
  busy: boolean;
  disabled: boolean;
  onSelect: (routeId: string) => void;
  recommended: boolean;
  route: Route;
  selected: boolean;
}) {
  const selectable = isSelectable(route);
  return (
    <button
      aria-label={`选择线路 ${route.displayName}`}
      aria-pressed={selected}
      className={`node-picker__option${selected ? " is-selected" : ""}`}
      disabled={disabled || !selectable}
      onClick={() => onSelect(route.id)}
      type="button"
    >
      <span aria-hidden="true" className="node-picker__mark">
        {selected ? <Check size={16} /> : <MapPin size={16} />}
      </span>
      <span className="node-picker__identity">
        <strong>{route.displayName}</strong>
        <small>{getRegionName(route.configuredRegion)}</small>
      </span>
      <span className="node-picker__health">
        <strong>{route.healthScore}</strong>
        <small>状态分</small>
      </span>
      <Badge
        tone={
          selected ? "positive" : recommended ? "info" : selectable ? "neutral" : "warning"
        }
      >
        {busy
          ? "正在验证"
          : selected
            ? "当前"
            : recommended
              ? "推荐"
              : selectable
                ? "可用"
                : "需修复"}
      </Badge>
    </button>
  );
}

function TargetNodeSelection({
  availableNodes,
  nodes,
  onPrepare,
  onRetest,
  onSelectRegion,
  preparingNodeId,
  region,
  route,
  testingLatency,
}: {
  availableNodes: SubscriptionNode[];
  nodes: SubscriptionNode[];
  onPrepare: (nodeId: string) => void;
  onRetest: () => void;
  onSelectRegion: (region: RegionCode) => void;
  preparingNodeId: string;
  region: RegionCode;
  route?: Route;
  testingLatency: boolean;
}) {
  if (!route || nodes.length === 0) {
    return null;
  }
  const regionCounts = new Map<RegionCode, number>();
  for (const node of availableNodes) {
    regionCounts.set(node.region, (regionCounts.get(node.region) ?? 0) + 1);
  }
  const availableRegions = (
    ["AUTO", "HK", "JP", "SG", "TW", "US", "UNKNOWN"] satisfies RegionCode[]
  ).filter(
    (candidate) => candidate === "AUTO" || regionCounts.has(candidate),
  );
  const visibleNodes =
    region === "AUTO" ? nodes : nodes.filter((node) => node.region === region);

  return (
    <div aria-labelledby="target-node-heading" className="target-node">
      <div className="target-node__heading">
        <div>
          <span>第 2 步</span>
          <h3 id="target-node-heading">按标签选择节点</h3>
          <p>
            {route.displayName} · 已从真实订阅发现 {nodes.length} 个节点
          </p>
        </div>
        <div className="target-node__heading-actions">
          <Badge tone="info">标签来自节点备注</Badge>
          <Button
            disabled={testingLatency || Boolean(preparingNodeId)}
            icon={
              <RefreshCw
                aria-hidden="true"
                className={testingLatency ? "is-spinning" : undefined}
                size={14}
              />
            }
            onClick={onRetest}
            variant="tertiary"
          >
            {testingLatency ? "正在测速" : "重新测速"}
          </Button>
        </div>
      </div>
      <div aria-label="节点标签区域" className="target-node__regions" role="group">
        {availableRegions.map((candidate) => (
          <button
            aria-pressed={candidate === region}
            className={candidate === region ? "is-selected" : ""}
            key={candidate}
            onClick={() => onSelectRegion(candidate)}
            type="button"
          >
            {candidate === "AUTO" ? "全部" : getRegionName(candidate)}
            <small>
              {candidate === "AUTO" ? nodes.length : regionCounts.get(candidate)}
            </small>
          </button>
        ))}
      </div>
      <div aria-label="线路内节点" className="target-node__list" role="group">
        {visibleNodes.map((node) => (
          <button
            aria-label={`选择节点 ${node.displayName}`}
            className="target-node__option"
            disabled={testingLatency || Boolean(preparingNodeId)}
            key={node.id}
            onClick={() => onPrepare(node.id)}
            type="button"
          >
            <span aria-hidden="true" className="target-node__mark">
              <MapPin size={15} />
            </span>
            <span>
              <strong>{node.displayName}</strong>
              <small>
                {getRegionName(node.region)} · {node.protocol} ·{" "}
                {formatNodeLatency(node)}
              </small>
            </span>
            <Badge
              tone={
                node.latencyStatus === "reachable"
                  ? "positive"
                  : node.latencyStatus && node.latencyStatus !== "unavailable"
                    ? "warning"
                    : node.region === "UNKNOWN"
                    ? "warning"
                    : "neutral"
              }
            >
              {preparingNodeId === node.id ? "正在重新验证" : "选择"}
            </Badge>
          </button>
        ))}
      </div>
      <p className="target-node__note">
        TLS 节点会完成证书校验和响应头握手，再取三次中位数；检测到 Fake-IP
        时会改用可信 DNS。普通 TCP 的瞬时本机接管结果不会冒充真实延迟。
      </p>
    </div>
  );
}

function CredentialSetupDialog({
  error,
  onClose,
  onSave,
  open,
  saving,
}: {
  error: string;
  onClose: () => void;
  onSave: (secret: string) => Promise<void>;
  open: boolean;
  saving: boolean;
}) {
  const [secret, setSecret] = useState("");
  const secretInputId = useId();

  function close() {
    if (!saving) {
      setSecret("");
      onClose();
    }
  }

  return (
    <Dialog
      description="旧版依赖系统凭据弹窗；新版改为 Glide 专属本机加密目录。"
      onClose={close}
      open={open}
      title="只需设置这一次"
    >
      <form
        className="credential-setup"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(secret).then(() => setSecret(""));
        }}
      >
        <span className="credential-setup__icon">
          <KeyRound aria-hidden="true" size={24} />
        </span>
        <h3>输入后台管理密码</h3>
        <p>
          这是你的 VPN 后台密码，不是电脑登录密码。验证一次后会保存到 Glide
          专属加密目录，以后直接读取。
        </p>
        <label className="field" htmlFor={secretInputId}>
          <span>后台管理密码</span>
          <input
            autoComplete="current-password"
            autoFocus
            disabled={saving}
            id={secretInputId}
            maxLength={maximumSecretLength}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="输入一次即可"
            type="password"
            value={secret}
          />
          <small>以后不会弹出电脑密码；不同线路密码请到“连接”页逐条更新。</small>
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          <Button disabled={saving} onClick={close}>
            取消
          </Button>
          <Button
            disabled={saving || !secret}
            icon={<LockKeyhole aria-hidden="true" size={16} />}
            type="submit"
            variant="primary"
          >
            {saving ? "正在验证全部连接…" : "验证并安全保存"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function formatOptimizationFeedback(result: RouteOptimizationResult): string {
  const verification =
    (result.verificationSamples ?? 0) >= 2 ? "，候选线路已完成两轮复测" : "";
  return result.failedCount > 0
    ? `线路优化完成：已验证真实订阅${verification}，另有 ${result.failedCount} 条线路未通过。`
    : `线路优化完成：已从 ${result.availableCount} 条线路中选出并验证真实订阅${verification}。`;
}

function formatVerificationSummary(result: LineSubscriptionResult): string {
  if ((result.verificationSamples ?? 0) >= 2) {
    return `已完成 ${result.verificationSamples} 轮真实验证，典型用时 ${
      result.verifiedInMs
    } ms，波动 ${result.stabilityDeltaMs ?? 0} ms。`;
  }
  return `后台与订阅内容均已读取成功${
    result.verifiedInMs > 0 ? `，用时 ${result.verifiedInMs} ms` : ""
  }。`;
}

function formatNodeLatency(node: SubscriptionNode): string {
  if (node.latencyStatus === "reachable" && node.latencyMs !== undefined) {
    const method = node.latencyMethod === "tls" ? "TLS" : "TCP";
    const sampleSummary =
      (node.latencySamples ?? 0) > 1 ? ` · ${node.latencySamples}次` : "";
    const jitterSummary =
      node.latencyJitterMs !== undefined ? ` · 波动 ${node.latencyJitterMs} ms` : "";
    const dnsSummary = node.latencySource === "trusted-dns" ? " · 已绕过 Fake-IP" : "";
    return `${method}入口 ${node.latencyMs} ms${sampleSummary}${jitterSummary}${dnsSummary}`;
  }
  if (node.latencyStatus === "timeout") {
    return "入口延迟超时";
  }
  if (node.latencyStatus === "dns-error") {
    return "节点 DNS 解析失败";
  }
  if (node.latencyStatus === "tls-error") {
    return "TLS 握手失败";
  }
  if (node.latencyStatus === "intercepted") {
    return "TCP 被本机代理接管";
  }
  return "等待重新测速";
}

function isSelectable(route: Route): boolean {
  return route.managementState === "connected" && route.subscriptionReady !== false;
}

function getRecommendationScore(route: Route): number {
  const verificationBonus = route.regionVerification === "verified" ? 25 : 0;
  const credentialBonus = route.credentialState === "healthy" ? 10 : 0;
  return route.healthScore + credentialBonus + verificationBonus;
}

function availableRegionPreference(
  nodes: SubscriptionNode[],
  preferredRegion: RegionCode,
): RegionCode {
  return preferredRegion === "AUTO" ||
    nodes.some((node) => node.region === preferredRegion)
    ? preferredRegion
    : "AUTO";
}
