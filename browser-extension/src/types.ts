export interface PlanUpdate {
  type: "plan:update";
  data: {
    id: string;
    steps: Array<{
      id: string;
      description: string;
      status: string;
      tier: number;
    }>;
  };
}

export interface StepUpdate {
  type: "step:update";
  data: {
    planId: string;
    id: string;
    status: string;
  };
}

export interface ApprovalRequest {
  type: "approval:request";
  data: {
    planId: string;
    id: string;
    description: string;
    tier: number;
  };
}

export type OrchestratorMessage = PlanUpdate | StepUpdate | ApprovalRequest;
