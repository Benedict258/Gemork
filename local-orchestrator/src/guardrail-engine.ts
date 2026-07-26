import { type PlanStep, type StepTier } from "./orchestrator/plan.js";

export type GuardrailAction = "allow" | "ask" | "deny";

export interface GuardrailContext {
  step: PlanStep;
  currentScope: string[];
  connectorId?: string;
}

export class GuardrailEngine {
  private tierPolicies: Record<StepTier, (ctx: GuardrailContext) => GuardrailAction> = {
    1: () => "allow",          // Tier 1: Read-only → fully autonomous
    2: () => "allow",          // Tier 2: Reversible writes → autonomous, logged
    3: (ctx) => {
      // Tier 3: Critical/irreversible → always ask
      return this.isWithinScope(ctx) ? "ask" : "ask";
    },
  };

  evaluate(ctx: GuardrailContext): GuardrailAction {
    const policy = this.tierPolicies[ctx.step.tier];
    return policy(ctx);
  }

  isWithinScope(ctx: GuardrailContext): boolean {
    if (ctx.step.tier === 1) return true;
    if (ctx.step.connectorId) {
      return ctx.currentScope.includes(ctx.currentScope[0] ?? "");
    }
    return true;
  }

  requiresApproval(step: PlanStep): boolean {
    return step.tier === 3;
  }
}
