import type { StepTier } from "../orchestrator/plan.js";

export type ToolName =
  | "read_file"
  | "read_directory"
  | "search"
  | "query"
  | "get_file_info"
  | "list_files"
  | "write_file"
  | "edit_file"
  | "create_directory"
  | "move_file"
  | "copy_file"
  | "send_message"
  | "delete_file"
  | "external_api"
  | "connector_read"
  | "connector_write"
  | "connector_delete";

export interface ToolClassification {
  tool: ToolName;
  tier: StepTier;
  description: string;
}

const TOOL_CLASSIFICATIONS: ToolClassification[] = [
  // Tier 1 — Read-only, autonomous
  { tool: "read_file", tier: 1, description: "Read file contents" },
  { tool: "read_directory", tier: 1, description: "List directory entries" },
  { tool: "search", tier: 1, description: "Search files or content" },
  { tool: "query", tier: 1, description: "Query vector/structured store" },
  { tool: "get_file_info", tier: 1, description: "Get file metadata" },
  { tool: "list_files", tier: 1, description: "List files in a path" },
  { tool: "connector_read", tier: 1, description: "Read from external connector" },

  // Tier 2 — Reversible writes, logged + undoable
  { tool: "write_file", tier: 2, description: "Write file contents" },
  { tool: "edit_file", tier: 2, description: "Edit file in place" },
  { tool: "create_directory", tier: 2, description: "Create a directory" },
  { tool: "move_file", tier: 2, description: "Move/rename a file" },
  { tool: "copy_file", tier: 2, description: "Copy a file" },
  { tool: "connector_write", tier: 2, description: "Write via external connector" },

  // Tier 3 — Critical / irreversible, always ask
  { tool: "send_message", tier: 3, description: "Send message to user or service" },
  { tool: "delete_file", tier: 3, description: "Delete a file permanently" },
  { tool: "external_api", tier: 3, description: "Call an external API" },
  { tool: "connector_delete", tier: 3, description: "Delete via external connector" },
];

const TOOL_CLASSIFICATION_MAP = new Map<ToolName, ToolClassification>(
  TOOL_CLASSIFICATIONS.map((tc) => [tc.tool, tc])
);

export function classifyTool(tool: ToolName): StepTier {
  return TOOL_CLASSIFICATION_MAP.get(tool)?.tier ?? 3;
}

export function getToolsForTier(tier: StepTier): ToolName[] {
  return TOOL_CLASSIFICATIONS.filter((tc) => tc.tier === tier).map((tc) => tc.tool);
}

export function getTier1Tools(): ToolName[] {
  return getToolsForTier(1);
}

export function getTier2Tools(): ToolName[] {
  return getToolsForTier(2);
}

export function getTier3Tools(): ToolName[] {
  return getToolsForTier(3);
}

export function isReadOnlyTool(tool: ToolName): boolean {
  return classifyTool(tool) === 1;
}

export function isReversibleTool(tool: ToolName): boolean {
  return classifyTool(tool) === 2;
}

export function isCriticalTool(tool: ToolName): boolean {
  return classifyTool(tool) === 3;
}

export function getAllClassifications(): readonly ToolClassification[] {
  return TOOL_CLASSIFICATIONS;
}
