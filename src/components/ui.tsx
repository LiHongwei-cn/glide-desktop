import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { DiagnosticStatus } from "@/domain/models";

interface BadgeProps {
  children: ReactNode;
  tone?: "critical" | "info" | "neutral" | "positive" | "warning";
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  variant?: "danger" | "primary" | "secondary" | "tertiary";
}

interface DialogProps {
  children: ReactNode;
  description?: string;
  onClose: () => void;
  open: boolean;
  title: string;
}

export function Badge({ children, tone = "neutral" }: BadgeProps) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Button({
  children,
  className = "",
  icon,
  type = "button",
  variant = "secondary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button--${variant} ${className}`.trim()}
      type={type}
      {...props}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

export function Dialog({ children, description, onClose, open, title }: DialogProps) {
  const descriptionId = useId();
  const dialogReference = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const previouslyFocusedElement = document.activeElement as HTMLElement | null;
    const dialogElement = dialogReference.current;
    const focusableElements = getFocusableElements(dialogElement);
    const preferredFormControl = dialogElement?.querySelector<HTMLElement>(
      "input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
    );
    (preferredFormControl ?? focusableElements[0])?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || focusableElements.length === 0) {
        return;
      }
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedElement?.focus();
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogReference}
        role="dialog"
      >
        <header className="dialog__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="dialog__body">{children}</div>
      </section>
    </div>
  );
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export function HealthRing({ score }: { score: number }) {
  const safeScore = Math.max(0, Math.min(100, score));
  return (
    <div
      aria-label={`健康度 ${safeScore} 分`}
      className="health-ring"
      role="img"
      style={{ "--health-score": `${safeScore * 3.6}deg` } as React.CSSProperties}
    >
      <div className="health-ring__inner">
        <strong>{safeScore}</strong>
        <span>健康度</span>
      </div>
    </div>
  );
}

export function StatusDot({ status }: { status: DiagnosticStatus }) {
  return <span aria-hidden="true" className={`status-dot status-dot--${status}`} />;
}
