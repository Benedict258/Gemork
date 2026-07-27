import { useState, useEffect, useCallback } from "react";

interface Workflow {
  id: string;
  name: string;
  description: string;
  goal: string;
  steps: Array<{ description: string; tier: number; connectorId?: string; expectedOutcome?: string }>;
  createdAt: string;
  lastUsed: string;
  useCount: number;
}

interface Schedule {
  id: string;
  projectId: string;
  workflowId?: string;
  goal: string;
  cron: string;
  enabled: boolean;
  lastRun?: string;
  nextRun: string;
}

interface WorkflowPanelProps {
  currentPlanId?: string;
  onReplay?: (goal: string) => void;
}

function WorkflowPanel({ currentPlanId, onReplay }: WorkflowPanelProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleGoal, setScheduleGoal] = useState("");
  const [scheduleCron, setScheduleCron] = useState("daily");
  const [loading, setLoading] = useState(false);

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch("/api/workflows");
      const data = await res.json();
      setWorkflows(data.workflows ?? []);
    } catch {
      // Ignore fetch errors
    }
  }, []);

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch("/api/schedules");
      const data = await res.json();
      setSchedules(data.schedules ?? []);
    } catch {
      // Ignore fetch errors
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
    fetchSchedules();
  }, [fetchWorkflows, fetchSchedules]);

  const saveCurrentPlan = async () => {
    if (!currentPlanId) return;
    setLoading(true);
    try {
      await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: currentPlanId }),
      });
      await fetchWorkflows();
    } finally {
      setLoading(false);
    }
  };

  const replayWorkflow = async (workflowId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workflows/${workflowId}/replay`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.plan && onReplay) {
        onReplay(data.plan.goalId);
      }
      await fetchWorkflows();
    } finally {
      setLoading(false);
    }
  };

  const createSchedule = async () => {
    if (!scheduleGoal.trim()) return;
    setLoading(true);
    try {
      await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: scheduleGoal, cron: scheduleCron }),
      });
      setScheduleGoal("");
      setShowScheduleForm(false);
      await fetchSchedules();
    } finally {
      setLoading(false);
    }
  };

  const deleteSchedule = async (id: string) => {
    await fetch(`/api/schedules/${id}`, { method: "DELETE" });
    await fetchSchedules();
  };

  const triggerSchedule = async (id: string) => {
    setLoading(true);
    try {
      await fetch(`/api/schedules/${id}/trigger`, { method: "POST" });
      await fetchSchedules();
    } finally {
      setLoading(false);
    }
  };

  const cronOptions = [
    "hourly",
    "daily",
    "weekly",
    "every 2 hours",
    "every 6 hours",
    "every 12 hours",
    "every 30 minutes",
  ];

  return (
    <div className="workflow-panel">
      <div className="workflow-section">
        <div className="section-header">
          <h3>Saved Workflows</h3>
          {currentPlanId && (
            <button
              className="save-workflow-btn"
              onClick={saveCurrentPlan}
              disabled={loading}
            >
              Save Current Plan
            </button>
          )}
        </div>

        {workflows.length === 0 ? (
          <p className="empty-text">No saved workflows yet.</p>
        ) : (
          <ul className="workflow-list">
            {workflows.map((wf) => (
              <li key={wf.id} className="workflow-item">
                <div className="workflow-info">
                  <span className="workflow-name">{wf.name}</span>
                  <span className="workflow-meta">
                    Used {wf.useCount} times
                    {wf.lastUsed && ` - Last: ${new Date(wf.lastUsed).toLocaleDateString()}`}
                  </span>
                </div>
                <button
                  className="replay-btn"
                  onClick={() => replayWorkflow(wf.id)}
                  disabled={loading}
                >
                  Replay
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="workflow-section">
        <div className="section-header">
          <h3>Schedules</h3>
          <button
            className="add-schedule-btn"
            onClick={() => setShowScheduleForm(!showScheduleForm)}
          >
            {showScheduleForm ? "Cancel" : "+ Add Schedule"}
          </button>
        </div>

        {showScheduleForm && (
          <div className="schedule-form">
            <input
              type="text"
              placeholder="Goal to execute"
              value={scheduleGoal}
              onChange={(e) => setScheduleGoal(e.target.value)}
            />
            <select
              value={scheduleCron}
              onChange={(e) => setScheduleCron(e.target.value)}
            >
              {cronOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <button
              className="create-schedule-btn"
              onClick={createSchedule}
              disabled={loading || !scheduleGoal.trim()}
            >
              Create
            </button>
          </div>
        )}

        {schedules.length === 0 ? (
          <p className="empty-text">No schedules configured.</p>
        ) : (
          <ul className="schedule-list">
            {schedules.map((sched) => (
              <li key={sched.id} className="schedule-item">
                <div className="schedule-info">
                  <span className="schedule-goal">{sched.goal}</span>
                  <span className="schedule-meta">
                    {sched.cron} - Next: {new Date(sched.nextRun).toLocaleString()}
                  </span>
                </div>
                <div className="schedule-actions">
                  <button
                    className="trigger-btn"
                    onClick={() => triggerSchedule(sched.id)}
                    disabled={loading}
                  >
                    Run Now
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => deleteSchedule(sched.id)}
                    disabled={loading}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default WorkflowPanel;
