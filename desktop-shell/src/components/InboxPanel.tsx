import { useCallback, useEffect, useState } from "react";
import type {
  InboxApprovalPayload,
  InboxItem,
  InboxNotificationPayload,
  InboxQuestionPayload,
  InboxStats,
} from "../types";

interface InboxPanelProps {
  items: InboxItem[];
  currentItem: InboxItem | null;
  stats: InboxStats;
  onResolve: (id: string, response?: unknown) => void;
  onCancel: (id: string) => void;
  onRefresh: () => void;
}

function InboxPanel({ items, currentItem, stats, onResolve, onCancel, onRefresh }: InboxPanelProps) {
  const [questionInput, setQuestionInput] = useState("");

  useEffect(() => {
    setQuestionInput("");
  }, [currentItem?.id]);

  const handleApprove = useCallback(() => {
    if (!currentItem || currentItem.type !== "approval") return;
    onResolve(currentItem.id, { approved: true });
  }, [currentItem, onResolve]);

  const handleReject = useCallback(() => {
    if (!currentItem || currentItem.type !== "approval") return;
    onResolve(currentItem.id, { approved: false, reason: "Rejected by user" });
  }, [currentItem, onResolve]);

  const handleQuestionSubmit = useCallback(() => {
    if (!currentItem || currentItem.type !== "question") return;
    onResolve(currentItem.id, { answer: questionInput });
    setQuestionInput("");
  }, [currentItem, onResolve, questionInput]);

  const handleDismiss = useCallback(() => {
    if (!currentItem || currentItem.type !== "notification") return;
    onResolve(currentItem.id);
  }, [currentItem, onResolve]);

  const handleCancel = useCallback(() => {
    if (!currentItem) return;
    onCancel(currentItem.id);
  }, [currentItem, onCancel]);

  const totalPending = stats.pending;
  const approvalCount = items.filter((i) => i.type === "approval").length;
  const questionCount = items.filter((i) => i.type === "question").length;
  const notificationCount = items.filter((i) => i.type === "notification").length;

  return (
    <div className="inbox-panel">
      <div className="inbox-header">
        <h3>Inbox</h3>
        <span className="inbox-badge">{totalPending}</span>
        <button className="inbox-refresh-btn" onClick={onRefresh} title="Refresh">
          ↻
        </button>
      </div>

      {totalPending === 0 && (
        <div className="inbox-empty">No pending items</div>
      )}

      {totalPending > 0 && (
        <div className="inbox-queue-summary">
          {approvalCount > 0 && <span>{approvalCount} approval{approvalCount !== 1 ? "s" : ""}</span>}
          {questionCount > 0 && <span>{questionCount} question{questionCount !== 1 ? "s" : ""}</span>}
          {notificationCount > 0 && <span>{notificationCount} notification{notificationCount !== 1 ? "s" : ""}</span>}
        </div>
      )}

      {currentItem && (
        <div className={`inbox-current inbox-current--${currentItem.type}`}>
          <div className="inbox-current-type">{currentItem.type}</div>

          {currentItem.type === "approval" && (
            <ApprovalItem
              payload={currentItem.payload as InboxApprovalPayload}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          )}

          {currentItem.type === "question" && (
            <QuestionItem
              payload={currentItem.payload as InboxQuestionPayload}
              input={questionInput}
              onInputChange={setQuestionInput}
              onSubmit={handleQuestionSubmit}
            />
          )}

          {currentItem.type === "notification" && (
            <NotificationItem
              payload={currentItem.payload as InboxNotificationPayload}
              onDismiss={handleDismiss}
            />
          )}

          <div className="inbox-current-actions">
            <button className="inbox-btn cancel" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {items.length > 1 && (
        <div className="inbox-remaining">
          {items.length - 1} more item{items.length - 1 !== 1 ? "s" : ""} in queue
        </div>
      )}
    </div>
  );
}

function ApprovalItem({
  payload,
  onApprove,
  onReject,
}: {
  payload: InboxApprovalPayload;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="inbox-approval">
      <div className="inbox-approval-desc">{payload.description}</div>
      <div className="inbox-approval-meta">
        <span className="inbox-tier">Tier {payload.tier}</span>
        {payload.rationale && <span className="inbox-rationale">{payload.rationale}</span>}
      </div>
      <div className="inbox-approval-actions">
        <button className="inbox-btn approve" onClick={onApprove}>
          Approve
        </button>
        <button className="inbox-btn reject" onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}

function QuestionItem({
  payload,
  input,
  onInputChange,
  onSubmit,
}: {
  payload: InboxQuestionPayload;
  input: string;
  onInputChange: (val: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="inbox-question">
      <div className="inbox-question-text">{payload.question}</div>
      {payload.context && <div className="inbox-question-context">{payload.context}</div>}
      <div className="inbox-question-input">
        <input
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Type your answer..."
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
        <button className="inbox-btn submit" onClick={onSubmit} disabled={!input.trim()}>
          Submit
        </button>
      </div>
    </div>
  );
}

function NotificationItem({
  payload,
  onDismiss,
}: {
  payload: InboxNotificationPayload;
  onDismiss: () => void;
}) {
  return (
    <div className={`inbox-notification inbox-notification--${payload.level}`}>
      <div className="inbox-notification-msg">{payload.message}</div>
      <button className="inbox-btn dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

export default InboxPanel;
