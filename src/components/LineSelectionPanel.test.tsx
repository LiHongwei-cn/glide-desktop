import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LineSelectionPanel } from "@/components/LineSelectionPanel";
import { initialState } from "@/data/seed";
import { CredentialSetupRequiredError } from "@/domain/errors";
import type { ConnectionGroup } from "@/domain/models";
import { createRouteFixtures } from "@/test/fixtures";

function createGroup(): ConnectionGroup {
  return {
    ...initialState.connectionGroups[0],
    routes: createRouteFixtures().map((route) => ({
      ...route,
      managementState: "connected" as const,
      subscriptionReady: true,
    })),
  };
}

function createSubscriptionNodes() {
  return [
    {
      displayName: "🇯🇵 日本 01",
      id: "0123456789ab",
      latencyJitterMs: 12,
      latencyMethod: "tls" as const,
      latencyMs: 118,
      latencySamples: 3,
      latencySource: "trusted-dns" as const,
      latencyStatus: "reachable" as const,
      protocol: "VLESS",
      region: "JP" as const,
    },
    {
      displayName: "🇸🇬 新加坡 01",
      id: "abcdef012345",
      latencyStatus: "timeout" as const,
      protocol: "VLESS",
      region: "SG" as const,
    },
  ];
}

function defaultProps() {
  return {
    group: createGroup(),
    onOpenClients: vi.fn(),
    onOptimize: vi.fn().mockResolvedValue({
      availableCount: 4,
      failedCount: 1,
      nodes: createSubscriptionNodes(),
      reason: "线路 2：本次响应较快",
      routeId: "test-route-jp",
      routeName: "线路 2",
      stabilityDeltaMs: 80,
      subscriptionUrl: "https://example.com/sub?token=test",
      verificationSamples: 2,
      verifiedInMs: 820,
    }),
    onPrepare: vi.fn().mockResolvedValue({
      nodes: createSubscriptionNodes(),
      responseTimeMs: 700,
      subscriptionUrl: "https://example.com/sub?token=test",
    }),
    onPrepareNode: vi.fn().mockResolvedValue({
      displayName: "🇯🇵 日本 01",
      nodeUri: "vless://private-node",
      protocol: "VLESS",
      region: "JP",
      responseTimeMs: 780,
    }),
    onSaveCredential: vi.fn().mockResolvedValue(undefined),
    onSelect: vi.fn(),
    onSelectRegion: vi.fn(),
  };
}

describe("LineSelectionPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("only reports success after receiving a verified subscription", async () => {
    const props = defaultProps();
    render(<LineSelectionPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "一键优化线路" }));

    expect(props.onOptimize).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("线路订阅已验证"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "复制整条订阅" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/另有 1 条线路未通过/)).toBeInTheDocument();
    expect(screen.getByText(/2 轮真实验证/)).toBeInTheDocument();
    expect(screen.getByText(/波动 80 ms/)).toBeInTheDocument();
    expect(screen.getByText(/TLS入口 118 ms/)).toBeInTheDocument();
    expect(screen.getByText(/3次 · 波动 12 ms · 已绕过 Fake-IP/)).toBeInTheDocument();
    expect(screen.getByText(/入口延迟超时/)).toBeInTheDocument();
  });

  it("validates a manually selected line before loading its nodes", async () => {
    const props = defaultProps();
    render(<LineSelectionPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "自己选线路" }));
    fireEvent.click(screen.getByRole("button", { name: "选择线路 线路 2" }));

    expect(props.onPrepare).toHaveBeenCalledWith("test-route-jp");
    expect(props.onPrepare).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/已验证线路 线路 2/)).toBeInTheDocument();
    expect(props.onSelect).toHaveBeenCalledWith("test-route-jp");
    expect(
      screen.getByRole("heading", { name: "按标签选择节点" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retests every visible node without reopening the line picker", async () => {
    const props = defaultProps();
    props.onPrepare
      .mockResolvedValueOnce({
        nodes: createSubscriptionNodes(),
        responseTimeMs: 700,
        subscriptionUrl: "https://example.com/sub?token=test",
      })
      .mockResolvedValueOnce({
        nodes: [
          {
            ...createSubscriptionNodes()[0],
            latencyJitterMs: 4,
            latencyMs: 66,
            latencySource: "system-dns",
          },
          createSubscriptionNodes()[1],
        ],
        responseTimeMs: 640,
        subscriptionUrl: "https://example.com/sub?token=test",
      });
    render(<LineSelectionPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "自己选线路" }));
    fireEvent.click(screen.getByRole("button", { name: "选择线路 线路 2" }));
    await screen.findByRole("button", { name: "重新测速" });
    fireEvent.click(screen.getByRole("button", { name: "重新测速" }));

    expect(await screen.findByText(/节点测速完成：1\/2/)).toBeInTheDocument();
    expect(screen.getByText(/TLS入口 66 ms · 3次 · 波动 4 ms/)).toBeInTheDocument();
    expect(props.onPrepare).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains DNS, TLS, and transparent-proxy failures separately", async () => {
    const props = defaultProps();
    props.onPrepare.mockResolvedValue({
      nodes: [
        {
          displayName: "DNS 节点",
          id: "111111111111",
          latencyStatus: "dns-error",
          protocol: "VLESS",
          region: "JP",
        },
        {
          displayName: "TLS 节点",
          id: "222222222222",
          latencyStatus: "tls-error",
          protocol: "VLESS",
          region: "JP",
        },
        {
          displayName: "TCP 节点",
          id: "333333333333",
          latencyStatus: "intercepted",
          protocol: "Shadowsocks",
          region: "JP",
        },
      ],
      responseTimeMs: 700,
      subscriptionUrl: "https://example.com/sub?token=test",
    });
    render(<LineSelectionPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "自己选线路" }));
    fireEvent.click(screen.getByRole("button", { name: "选择线路 线路 2" }));

    expect(
      await screen.findByRole("button", { name: "选择节点 DNS 节点" }),
    ).toHaveTextContent("节点 DNS 解析失败");
    expect(
      screen.getByRole("button", { name: "选择节点 TLS 节点" }),
    ).toHaveTextContent("TLS 握手失败");
    expect(
      screen.getByRole("button", { name: "选择节点 TCP 节点" }),
    ).toHaveTextContent("TCP 被本机代理接管");
  });

  it("recommends the verified line over a slightly healthier conflict", () => {
    render(<LineSelectionPanel {...defaultProps()} />);

    fireEvent.click(screen.getByRole("button", { name: "自己选线路" }));

    expect(
      screen.getByRole("button", { name: "选择线路 线路 2" }),
    ).toHaveTextContent("推荐");
  });

  it("prevents selecting a line whose management state needs repair", () => {
    const props = defaultProps();
    props.group.routes[0] = {
      ...props.group.routes[0],
      managementState: "error",
    };
    render(<LineSelectionPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "自己选线路" }));

    expect(
      screen.getByRole("button", { name: "选择线路 线路 1" }),
    ).toBeDisabled();
  });

  it("offers one-time credential migration and retries optimization", async () => {
    const props = defaultProps();
    props.onOptimize
      .mockRejectedValueOnce(new CredentialSetupRequiredError())
      .mockResolvedValueOnce({
        availableCount: 5,
        failedCount: 0,
        nodes: createSubscriptionNodes(),
        reason: "线路 2：本次响应较快",
        routeId: "test-route-jp",
        routeName: "线路 2",
        subscriptionUrl: "https://example.com/sub?token=test",
        verifiedInMs: 700,
      });
    render(<LineSelectionPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "一键优化线路" }));
    expect(
      await screen.findByRole("heading", { name: "只需设置这一次" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^后台管理密码/), {
      target: { value: "local-test-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "验证并安全保存" }));

    expect(props.onSaveCredential).toHaveBeenCalledWith("local-test-password");
    expect(await screen.findByText("线路订阅已验证")).toBeInTheDocument();
    expect(props.onOptimize).toHaveBeenCalledTimes(2);
  });

  it("filters nodes by target region and prepares only the selected node", async () => {
    const props = defaultProps();
    render(<LineSelectionPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "自己选线路" }));
    fireEvent.click(screen.getByRole("button", { name: "选择线路 线路 2" }));
    await screen.findByRole("heading", { name: "按标签选择节点" });
    fireEvent.click(screen.getByRole("button", { name: "日本1" }));

    expect(
      screen.getByRole("button", { name: "选择节点 🇯🇵 日本 01" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "选择节点 🇸🇬 新加坡 01" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "选择节点 🇯🇵 日本 01" }),
    );

    expect(props.onPrepareNode).toHaveBeenCalledWith(
      "test-route-jp",
      "0123456789ab",
    );
    expect(await screen.findByText(/整条订阅仍保留/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制整条订阅" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "订阅二维码" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制当前节点" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "节点二维码" })).toBeInTheDocument();
  });

  it("switches to the fastest verified line that contains the selected region", async () => {
    const props = defaultProps();
    const [japanNode, singaporeNode] = createSubscriptionNodes();
    props.onOptimize.mockResolvedValue({
      availableCount: 2,
      failedCount: 0,
      nodes: [japanNode],
      reason: "线路 2：本轮综合得分最高",
      routeId: "test-route-jp",
      routeName: "线路 2",
      routeOptions: [
        {
          nodes: [japanNode],
          routeId: "test-route-jp",
          routeName: "线路 2",
          stabilityDeltaMs: 20,
          subscriptionUrl: "https://example.com/jp-sub",
          verificationSamples: 2,
          verifiedInMs: 600,
        },
        {
          nodes: [singaporeNode],
          routeId: "test-route-sg",
          routeName: "线路 3",
          stabilityDeltaMs: 30,
          subscriptionUrl: "https://example.com/sg-sub",
          verificationSamples: 2,
          verifiedInMs: 650,
        },
      ],
      stabilityDeltaMs: 20,
      subscriptionUrl: "https://example.com/jp-sub",
      verificationSamples: 2,
      verifiedInMs: 600,
    });
    render(<LineSelectionPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "一键优化线路" }));
    await screen.findByText("线路订阅已验证");
    fireEvent.click(screen.getByRole("button", { name: "新加坡1" }));

    expect(props.onSelectRegion).toHaveBeenCalledWith("SG");
    expect(props.onSelect).toHaveBeenCalledWith("test-route-sg");
    expect(await screen.findByText(/本轮响应最优的 线路 3/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "选择节点 🇸🇬 新加坡 01" }),
    ).toBeInTheDocument();
  });

  it("falls back to all nodes when the saved region is unavailable on a new line", async () => {
    const props = defaultProps();
    props.group.preferredRegion = "JP";
    props.onPrepare.mockResolvedValue({
      nodes: [
        {
          displayName: "🇸🇬 新加坡 01",
          id: "abcdef012345",
          protocol: "VLESS",
          region: "SG",
        },
      ],
      responseTimeMs: 760,
      subscriptionUrl: "https://example.com/sub?token=test",
    });
    render(<LineSelectionPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "自己选线路" }));
    fireEvent.click(screen.getByRole("button", { name: "选择线路 线路 2" }));

    expect(await screen.findByRole("button", { name: "全部1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "选择节点 🇸🇬 新加坡 01" }),
    ).toBeInTheDocument();
  });
});
