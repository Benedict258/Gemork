import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export interface TaskRow {
  id: string;
  projectId: string;
  goalId: string;
  description: string;
  tier: 1 | 2 | 3;
  status: string;
  connectorId?: string;
  rationale?: string;
  createdAt: string;
  completedAt?: string;
}

export interface PlanRow {
  id: string;
  projectId: string;
  goalId: string;
  status: string;
  createdAt: string;
  completedAt?: string;
}

export interface ConnectorConfig {
  id: string;
  projectId: string;
  connectorType: string;
  configJson: string;
  enabled: boolean;
  createdAt: string;
}

export interface PermissionRecord {
  id: string;
  toolName: string;
  scopeType: string;
  scopeValue: string;
  granted: boolean;
  grantedAt: string;
  expiresAt?: string;
}

const DB_DIR = ".gemork";
const DB_NAME = "gemork.db";

function getDbPath(projectId: string): string {
  const dir = join(process.cwd(), DB_DIR, projectId);
  mkdirSync(dir, { recursive: true });
  return join(dir, DB_NAME);
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      goalId TEXT NOT NULL,
      description TEXT NOT NULL,
      tier INTEGER NOT NULL CHECK(tier IN (1, 2, 3)),
      status TEXT NOT NULL DEFAULT 'pending',
      connectorId TEXT,
      rationale TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      completedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      goalId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'generating',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      completedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS plan_steps (
      id TEXT PRIMARY KEY,
      planId TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      goalId TEXT NOT NULL,
      description TEXT NOT NULL,
      tier INTEGER NOT NULL CHECK(tier IN (1, 2, 3)),
      status TEXT NOT NULL DEFAULT 'pending',
      connectorId TEXT,
      rationale TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      completedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS connector_configs (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      connectorType TEXT NOT NULL,
      configJson TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      toolName TEXT NOT NULL,
      scopeType TEXT NOT NULL,
      scopeValue TEXT NOT NULL,
      granted INTEGER NOT NULL DEFAULT 0,
      grantedAt TEXT NOT NULL DEFAULT (datetime('now')),
      expiresAt TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(projectId);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(projectId);
    CREATE INDEX IF NOT EXISTS idx_plan_steps_plan ON plan_steps(planId);
    CREATE INDEX IF NOT EXISTS idx_permissions_tool ON permissions(toolName, scopeType, scopeValue);
  `);
}

export class MemoryStore {
  private db: Database.Database;
  private projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
    this.db = new Database(getDbPath(projectId));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    initSchema(this.db);
  }

  close(): void {
    this.db.close();
  }

  // ── Tasks ──

  createTask(
    task: Omit<TaskRow, "id" | "createdAt">
  ): TaskRow {
    const id = crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, projectId, goalId, description, tier, status, connectorId, rationale)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      task.projectId,
      task.goalId,
      task.description,
      task.tier,
      task.status,
      task.connectorId ?? null,
      task.rationale ?? null
    );
    return this.getTask(id)!;
  }

  getTask(id: string): TaskRow | undefined {
    const stmt = this.db.prepare("SELECT * FROM tasks WHERE id = ?");
    return stmt.get(id) as TaskRow | undefined;
  }

  updateTaskStatus(id: string, status: string): boolean {
    const completedAt = status === "completed" || status === "failed"
      ? new Date().toISOString()
      : undefined;
    const stmt = this.db.prepare(
      "UPDATE tasks SET status = ?, completedAt = COALESCE(?, completedAt) WHERE id = ?"
    );
    const result = stmt.run(status, completedAt ?? null, id);
    return result.changes > 0;
  }

  listTasks(projectId: string, status?: string): TaskRow[] {
    if (status) {
      const stmt = this.db.prepare(
        "SELECT * FROM tasks WHERE projectId = ? AND status = ? ORDER BY createdAt DESC"
      );
      return stmt.all(projectId, status) as TaskRow[];
    }
    const stmt = this.db.prepare(
      "SELECT * FROM tasks WHERE projectId = ? ORDER BY createdAt DESC"
    );
    return stmt.all(projectId) as TaskRow[];
  }

  deleteTask(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM tasks WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ── Plans ──

  createPlan(
    plan: Omit<PlanRow, "id" | "createdAt">
  ): PlanRow {
    const id = crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO plans (id, projectId, goalId, status)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, plan.projectId, plan.goalId, plan.status);
    return this.getPlan(id)!;
  }

  getPlan(id: string): PlanRow | undefined {
    const stmt = this.db.prepare("SELECT * FROM plans WHERE id = ?");
    return stmt.get(id) as PlanRow | undefined;
  }

  updatePlanStatus(id: string, status: string): boolean {
    const completedAt = status === "completed" || status === "failed"
      ? new Date().toISOString()
      : undefined;
    const stmt = this.db.prepare(
      "UPDATE plans SET status = ?, completedAt = COALESCE(?, completedAt) WHERE id = ?"
    );
    const result = stmt.run(status, completedAt ?? null, id);
    return result.changes > 0;
  }

  listPlans(projectId: string): PlanRow[] {
    const stmt = this.db.prepare(
      "SELECT * FROM plans WHERE projectId = ? ORDER BY createdAt DESC"
    );
    return stmt.all(projectId) as PlanRow[];
  }

  // ── Plan Steps ──

  addPlanStep(
    planId: string,
    step: { goalId: string; description: string; tier: 1 | 2 | 3; connectorId?: string; rationale?: string }
  ): { id: string } {
    const id = crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO plan_steps (id, planId, goalId, description, tier, connectorId, rationale)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, planId, step.goalId, step.description, step.tier, step.connectorId ?? null, step.rationale ?? null);
    return { id };
  }

  updatePlanStepStatus(id: string, status: string): boolean {
    const completedAt = status === "completed" || status === "failed"
      ? new Date().toISOString()
      : undefined;
    const stmt = this.db.prepare(
      "UPDATE plan_steps SET status = ?, completedAt = COALESCE(?, completedAt) WHERE id = ?"
    );
    const result = stmt.run(status, completedAt ?? null, id);
    return result.changes > 0;
  }

  getPlanSteps(planId: string): Array<TaskRow & { planId: string }> {
    const stmt = this.db.prepare(
      "SELECT * FROM plan_steps WHERE planId = ? ORDER BY createdAt ASC"
    );
    return stmt.all(planId) as Array<TaskRow & { planId: string }>;
  }

  // ── Connector Configs ──

  setConnectorConfig(config: Omit<ConnectorConfig, "id" | "createdAt">): ConnectorConfig {
    const id = crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO connector_configs (id, projectId, connectorType, configJson, enabled)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, config.projectId, config.connectorType, config.configJson, config.enabled ? 1 : 0);
    return this.getConnectorConfig(id)!;
  }

  getConnectorConfig(id: string): ConnectorConfig | undefined {
    const stmt = this.db.prepare("SELECT * FROM connector_configs WHERE id = ?");
    return stmt.get(id) as ConnectorConfig | undefined;
  }

  listConnectorConfigs(projectId: string): ConnectorConfig[] {
    const stmt = this.db.prepare(
      "SELECT * FROM connector_configs WHERE projectId = ? ORDER BY createdAt DESC"
    );
    return stmt.all(projectId) as ConnectorConfig[];
  }

  deleteConnectorConfig(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM connector_configs WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ── Permissions ──

  grantPermission(
    toolName: string,
    scopeType: string,
    scopeValue: string,
    expiresAt?: string
  ): PermissionRecord {
    const id = crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO permissions (id, toolName, scopeType, scopeValue, granted, grantedAt, expiresAt)
      VALUES (?, ?, ?, ?, 1, datetime('now'), ?)
    `);
    stmt.run(id, toolName, scopeType, scopeValue, expiresAt ?? null);
    return this.getPermission(id)!;
  }

  revokePermission(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM permissions WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  getPermission(id: string): PermissionRecord | undefined {
    const stmt = this.db.prepare("SELECT * FROM permissions WHERE id = ?");
    return stmt.get(id) as PermissionRecord | undefined;
  }

  checkPermission(toolName: string, scopeType: string, scopeValue: string): boolean {
    const stmt = this.db.prepare(`
      SELECT granted FROM permissions
      WHERE toolName = ? AND scopeType = ? AND scopeValue = ?
        AND (expiresAt IS NULL OR expiresAt > datetime('now'))
      ORDER BY grantedAt DESC LIMIT 1
    `);
    const row = stmt.get(toolName, scopeType, scopeValue) as { granted: number } | undefined;
    return row?.granted === 1;
  }

  listPermissions(toolName?: string): PermissionRecord[] {
    if (toolName) {
      const stmt = this.db.prepare(
        "SELECT * FROM permissions WHERE toolName = ? ORDER BY grantedAt DESC"
      );
      return stmt.all(toolName) as PermissionRecord[];
    }
    const stmt = this.db.prepare("SELECT * FROM permissions ORDER BY grantedAt DESC");
    return stmt.all() as PermissionRecord[];
  }
}
