import { useCallback, useState } from "react";
import { useOrchestrator } from "./hooks/useOrchestrator";
import TaskInput from "./components/TaskInput";
import VoiceInput from "./components/VoiceInput";
import PlanView from "./components/PlanView";
import ApprovalModal from "./components/ApprovalModal";
import ConnectionStatus from "./components/ConnectionStatus";

function App() {
  const {
    connected,
    currentPlan,
    pendingApproval,
    submitGoal,
    approveStep,
    rejectStep,
    reconnect,
  } = useOrchestrator();

  const [goalText, setGoalText] = useState("");

  const isExecuting =
    currentPlan?.status === "executing" ||
    currentPlan?.status === "generating" ||
    currentPlan?.status === "awaiting_approval";

  const handleVoiceTranscription = useCallback((text: string) => {
    setGoalText((prev) => (prev ? `${prev} ${text}` : text));
  }, []);

  const handleSubmit = useCallback(
    (text: string) => {
      submitGoal(text);
      setGoalText("");
    },
    [submitGoal],
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>Gemork</h1>
          <span className="subtitle">Cowork with Gemma</span>
        </div>
        <ConnectionStatus status={connected} onReconnect={reconnect} />
      </header>

      <main className="app-main">
        <div className="task-input-row">
          <TaskInput
            onSubmit={handleSubmit}
            disabled={isExecuting}
            value={goalText}
            onChange={setGoalText}
          />
          <VoiceInput
            onTranscription={handleVoiceTranscription}
            disabled={isExecuting || connected !== "connected"}
          />
        </div>

        {isExecuting && !currentPlan && (
          <div className="loading">
            <p>Generating plan...</p>
          </div>
        )}

        <PlanView plan={currentPlan} />
      </main>

      {pendingApproval && (
        <ApprovalModal
          request={pendingApproval}
          onApprove={approveStep}
          onReject={rejectStep}
        />
      )}
    </div>
  );
}

export default App;
