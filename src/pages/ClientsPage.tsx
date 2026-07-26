import { Apple, CheckCircle2, ExternalLink, MonitorDown, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Badge, Button } from "@/components/ui";
import { clientOptions } from "@/data/seed";
import type { RuntimeInfo } from "@/domain/models";
import { openOfficialUrl } from "@/services/desktop";

export function ClientsPage({ runtimeInfo }: { runtimeInfo: RuntimeInfo }) {
  const [error, setError] = useState("");
  const [openingClientId, setOpeningClientId] = useState("");
  const runtimePlatform =
    runtimeInfo.operatingSystem === "macOS" || runtimeInfo.operatingSystem === "Windows"
      ? runtimeInfo.operatingSystem
      : "";
  const sortedClients = [...clientOptions].sort((clientA, clientB) => {
    const score = (operatingSystems: string[]) =>
      runtimePlatform && operatingSystems.includes(runtimePlatform) ? 1 : 0;
    return score(clientB.operatingSystems) - score(clientA.operatingSystems);
  });

  async function openClientDownload(clientId: string, officialUrl: string) {
    setError("");
    setOpeningClientId(clientId);
    try {
      await openOfficialUrl(officialUrl);
    } catch (openError) {
      setError(
        openError instanceof Error ? openError.message : "无法打开官方发布页。",
      );
    } finally {
      setOpeningClientId("");
    }
  }

  return (
    <div className="page">
      <PageHeader
        subtitle="选择适合当前系统的开源客户端，只打开官方发布页。"
        title="下载客户端"
      />

      <section className="distribution-note">
        <ShieldCheck aria-hidden="true" size={20} />
        <div>
          <strong>官方下载与签名优先</strong>
          <p>
            当前检测为 {runtimeInfo.operatingSystem} · {runtimeInfo.architecture}。
            只从下列维护者的 Releases 页面选择匹配架构。
          </p>
        </div>
      </section>

      {error ? (
        <p className="inline-alert" role="alert">
          {error}
        </p>
      ) : null}

      <div className="client-grid">
        {sortedClients.map((client) => {
          const recommended =
            Boolean(runtimePlatform) && client.operatingSystems.includes(runtimePlatform);
          return (
            <article className="client-card" key={client.id}>
            <header>
              <span className="client-card__icon">
                {client.operatingSystems.includes("macOS") ? (
                  <Apple aria-hidden="true" size={24} />
                ) : (
                  <MonitorDown aria-hidden="true" size={24} />
                )}
              </span>
              <Badge tone={recommended ? "info" : "positive"}>
                {recommended ? "适合本机" : "官方来源"}
              </Badge>
            </header>
            <h2>{client.name}</h2>
            <p>{client.summary}</p>
            <dl>
              <div>
                <dt>维护者</dt>
                <dd>{client.publisher}</dd>
              </div>
              <div>
                <dt>平台</dt>
                <dd>{client.operatingSystems.join(" · ")}</dd>
              </div>
              <div>
                <dt>架构</dt>
                <dd>{client.architectures.join(" · ")}</dd>
              </div>
              <div>
                <dt>许可证</dt>
                <dd>{client.license}</dd>
              </div>
            </dl>
            <div className="client-card__protocols">
              {client.protocolSupport.map((protocol) => (
                <span key={protocol}>
                  <CheckCircle2 aria-hidden="true" size={13} />
                  {protocol}
                </span>
              ))}
            </div>
            <Button
              disabled={openingClientId === client.id}
              icon={<ExternalLink aria-hidden="true" size={15} />}
              onClick={() => void openClientDownload(client.id, client.officialUrl)}
            >
              {openingClientId === client.id ? "正在打开…" : "打开官方发布页"}
            </Button>
          </article>
          );
        })}
      </div>

      <section className="notice-card">
        <ShieldCheck aria-hidden="true" size={18} />
        <div>
          <strong>大陆分发仍是发布闸门</strong>
          <p>仅有 GitHub 链接不满足“无需其他 VPN 下载”，正式版必须建立授权镜像和签名校验。</p>
        </div>
      </section>
    </div>
  );
}
