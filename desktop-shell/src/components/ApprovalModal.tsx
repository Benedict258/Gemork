import type { ApprovalRequestEvent } from "../types";

interface ApprovalModalProps {
  request: ApprovalRequestEvent;
  onApprove: () => void;
  onReject: (reason?: string) => void;
}

function ApprovalModal({ request, onApprove, onReject }: ApprovalModalProps) {
  const { step } = request;

  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <h2 id="modal-title">Approval Required</h2>
          <span className="modal-tier-badge">Tier 3</span>
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
          <button className="modal-btn approve" onClick={onApprove}>
            Approve
          </button>
          <button className="modal-btn reject" onClick={() => onReject()}>
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

export default ApprovalModal;
