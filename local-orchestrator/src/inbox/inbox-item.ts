import { v4 as uuid } from "uuid";

export type InboxItemType = "approval" | "question" | "notification";
export type InboxItemStatus = "pending" | "resolved" | "cancelled";

export type InboxNotificationLevel = "info" | "warning" | "error";

export interface ApprovalPayload {
  planId: string;
  stepId: string;
  description: string;
  tier: number;
  rationale?: string;
}

export interface QuestionPayload {
  question: string;
  context?: string;
  options?: string[];
}

export interface NotificationPayload {
  message: string;
  level: InboxNotificationLevel;
}

export type InboxPayload = ApprovalPayload | QuestionPayload | NotificationPayload;

export interface InboxItem {
  id: string;
  type: InboxItemType;
  status: InboxItemStatus;
  payload: InboxPayload;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
}

export function createInboxItem(
  type: InboxItemType,
  payload: InboxPayload,
  status: InboxItemStatus = "pending",
): InboxItem {
  return {
    id: uuid(),
    type,
    status,
    payload,
    createdAt: new Date(),
  };
}

const TYPE_PRIORITY: Record<InboxItemType, number> = {
  approval: 0,
  question: 1,
  notification: 2,
};

export function compareInboxPriority(a: InboxItem, b: InboxItem): number {
  return TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
}
