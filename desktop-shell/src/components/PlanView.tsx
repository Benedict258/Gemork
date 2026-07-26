interface PlanStep {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  tier: 1 | 2 | 3;
}

interface PlanViewProps {
  steps: PlanStep[];
}

function PlanView({ steps }: PlanViewProps) {
  return (
    <div className="plan-view">
      <h2>Plan</h2>
      <ul className="plan-steps">
        {steps.map((step) => (
          <li key={step.id} className={`plan-step ${step.status}`}>
            <span className="step-status">
              {step.status === "completed" ? "✓" : step.status === "running" ? "●" : step.status === "failed" ? "✗" : "○"}
            </span>
            <span className="step-description">{step.description}</span>
            <span className="step-tier">Tier {step.tier}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PlanView;
