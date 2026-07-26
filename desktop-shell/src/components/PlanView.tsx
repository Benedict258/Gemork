import { useState } from "react";
import type { Plan, PlanStep, StepStatus } from "../types";

interface PlanViewProps {
  plan: Plan | null;
}

const tierLabel: Record<number, string> = {
  1: "Tier 1",
  2: "Tier 2",
  3: "Tier 3",
};

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === "completed") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    );
  }
  if (status === "running") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (status === "awaiting_approval") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function formatDuration(start?: string, end?: string): string {
  if (!start) return "";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const ms = e - s;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function StepRow({ step, index }: { step: PlanStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = step.rationale || step.connectorId || step.startedAt;
  const isRunning = step.status === "running";

  return (
    <li
      className={`plan-step ${step.status}`}
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      <div
        className="step-main"
        onClick={() => hasDetails && setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (hasDetails && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        role={hasDetails ? "button" : undefined}
        tabIndex={hasDetails ? 0 : undefined}
        aria-expanded={hasDetails ? expanded : undefined}
      >
        <div className={`step-status-icon status-${step.status}`}>
          <StatusIcon status={step.status} />
        </div>
        <span className="step-number">{index + 1}</span>
        <span className="step-description">{step.description}</span>
        {isRunning && step.startedAt && (
          <span className="step-duration">{formatDuration(step.startedAt)}</span>
        )}
        <span className={`step-tier tier-${step.tier}`}>
          {tierLabel[step.tier]}
        </span>
        {hasDetails && (
          <span className="step-expand">{expanded ? "\u25BE" : "\u25B8"}</span>
        )}
      </div>
      {expanded && (
        <div className="step-details">
          {step.rationale && (
            <div className="detail-row">
              <span className="detail-label">Rationale</span>
              <span className="detail-value">{step.rationale}</span>
            </div>
          )}
          {step.connectorId && (
            <div className="detail-row">
              <span className="detail-label">Connector</span>
              <span className="detail-value">{step.connectorId}</span>
            </div>
          )}
          {step.startedAt && (
            <div className="detail-row">
              <span className="detail-label">Duration</span>
              <span className="detail-value">
                {formatDuration(step.startedAt, step.completedAt)}
              </span>
            </div>
          )}
          {step.error && (
            <div className="detail-row error">
              <span className="detail-label">Error</span>
              <span className="detail-value">{step.error}</span>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function PlanView({ plan }: PlanViewProps) {
  if (!plan) return null;

  const completed = plan.steps.filter(
    (s) => s.status === "completed" || s.status === "failed",
  ).length;
  const total = plan.steps.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="plan-view">
      <div className="plan-header">
        <h2>Plan</h2>
        <span className={`plan-status plan-status-${plan.status}`}>
          {plan.status.replace("_", " ")}
        </span>
      </div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-text">
        {completed}/{total} steps ({pct}%)
      </div>

      <ul className="plan-steps">
        {plan.steps.map((step, i) => (
          <StepRow key={step.id} step={step} index={i} />
        ))}
      </ul>
    </div>
  );
}

export default PlanView;
