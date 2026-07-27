import { v4 as uuid } from "uuid";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { StepTier } from "../orchestrator/plan.js";

const MEMORY_ROOT = ".gemork";

export interface WorkflowStep {
  description: string;
  tier: StepTier;
  connectorId?: string;
  expectedOutcome?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  goal: string;
  steps: WorkflowStep[];
  createdAt: string;
  lastUsed: string;
  useCount: number;
}

function workflowsDir(projectId: string): string {
  return join(process.cwd(), MEMORY_ROOT, projectId, "workflows");
}

function workflowFilePath(projectId: string, workflowId: string): string {
  return join(workflowsDir(projectId), `${workflowId}.json`);
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function readWorkflowFile(projectId: string, workflowId: string): Promise<Workflow | null> {
  const filePath = workflowFilePath(projectId, workflowId);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as Workflow;
  } catch {
    return null;
  }
}

export class WorkflowStore {
  async saveWorkflow(projectId: string, workflow: Omit<Workflow, "id" | "createdAt" | "lastUsed" | "useCount">): Promise<string> {
    const id = uuid();
    const full: Workflow = {
      ...workflow,
      id,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      useCount: 0,
    };

    const dir = workflowsDir(projectId);
    await ensureDir(dir);

    const filePath = workflowFilePath(projectId, id);
    await writeFile(filePath, JSON.stringify(full, null, 2), "utf-8");

    return id;
  }

  async getWorkflow(projectId: string, workflowId: string): Promise<Workflow | null> {
    return readWorkflowFile(projectId, workflowId);
  }

  async listWorkflows(projectId: string): Promise<Workflow[]> {
    const dir = workflowsDir(projectId);
    try {
      const entries = await readdir(dir);
      const jsonFiles = entries.filter((e) => e.endsWith(".json"));
      const workflows: Workflow[] = [];

      for (const file of jsonFiles) {
        const filePath = join(dir, file);
        try {
          const raw = await readFile(filePath, "utf-8");
          workflows.push(JSON.parse(raw) as Workflow);
        } catch {
          // Skip corrupt files
        }
      }

      return workflows.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    } catch {
      return [];
    }
  }

  async deleteWorkflow(projectId: string, workflowId: string): Promise<boolean> {
    const filePath = workflowFilePath(projectId, workflowId);
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async incrementUseCount(projectId: string, workflowId: string): Promise<void> {
    const workflow = await readWorkflowFile(projectId, workflowId);
    if (!workflow) return;

    workflow.useCount += 1;
    workflow.lastUsed = new Date().toISOString();

    const filePath = workflowFilePath(projectId, workflowId);
    await writeFile(filePath, JSON.stringify(workflow, null, 2), "utf-8");
  }
}
