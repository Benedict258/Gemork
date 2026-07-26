import { useState } from "react";
import type { Plan, PlanStep, StepStatus } from "../types";

interface PlanViewProps {
  plan: Plan | null;
}

const statusIcon: Record<StepStatus, string> = {
  pending: "○",
  running: "●",
  completed: "✓",
  failed: "✗",
  awaiting_approval: "◎",
};

const tierLabel: Record<number, string> = {
  1: "Tier 1",
  2: "Tier 2",
  3: "Tier 3",
};

function formatDuration(start?: string, end?: string): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const ms = e - s;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function StepRow({ step }: { step: PlanStep }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = step.rationale || step.connectorId || step.startedAt;

  return (
    <li className={`plan-step ${step.status}`}>
      <div
        className="step-main"
        onClick={() => hasDetails && setExpanded(!expanded)}
        role={hasDetails ? "button" : undefined}
        tabIndex={hasDetails ? 0 : undefined}
      >
        <span className={`step-status status-${step.status}`}>
          {statusIcon[step.status]}
        </span>
        <span className="step-description">{step.description}</span>
        <span className={`step-tier tier-${step.tier}`}>
          {tierLabel[step.tier]}
        </span>
        {hasDetails && (
          <span className="step-expand">{expanded ? "▾" : "▸"}</span>
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
          {plan.status}
        </span>
      </div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
        <span className="progress-text">
          {completed}/{total} steps ({pct}%)
        </span>
      </div>

      <ul className="plan-steps">
        {plan.steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </ul>
    </div>
  );
}

export default PlanView;
