import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalRequestEvent } from "../types";

interface ApprovalModalProps {
  request: ApprovalRequestEvent;
  onApprove: () => void;
  onReject: (reason?: string) => void;
}

function ApprovalModal({ request, onApprove, onReject }: ApprovalModalProps) {
  const { step } = request;
  const [loading, setLoading] = useState(false);
  const approveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    approveRef.current?.focus();
  }, []);

  const handleApprove = useCallback(() => {
    setLoading(true);
    onApprove();
  }, [onApprove]);

  const handleReject = useCallback(() => {
    setLoading(true);
    onReject();
  }, [onReject]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (loading) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleApprove();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleReject();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, handleApprove, handleReject]);

  const tierClass = `tier-${step.tier}`;
  const tierBadgeClass = step.tier === 3 ? "" : tierClass;

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <h2 id="modal-title">Approval Required</h2>
          <span className={`modal-tier-badge ${tierBadgeClass}`}>
            Tier {step.tier}
          </span>
        </div>

        <div className="modal-body">
          <div className="modal-step-desc">{step.description}</div>

          {step.rationale && (
            <div className="modal-section">
              <span className="modal-section-label">Rationale</span>
              <p>{step.rationale}</p>
            </div>
          )}

          <div className="modal-section">
            <span className="modal-section-label">What will happen</span>
            <p>This step requires your explicit approval before execution.</p>
          </div>

          {step.connectorId && (
            <div className="modal-section">
              <span className="modal-section-label">Connector</span>
              <p>{step.connectorId}</p>
            </div>
          )}
        </div>

        <div className="modal-actions">
          {loading ? (
            <div className="modal-loading" style={{ flex: 1 }}>
              <div className="spinner" />
              Processing...
            </div>
          ) : (
            <>
              <button
                ref={approveRef}
                className="modal-btn approve"
                onClick={handleApprove}
              >
                Approve
              </button>
              <button
                className="modal-btn reject"
                onClick={handleReject}
              >
                Reject
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ApprovalModal;
