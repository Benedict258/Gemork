import { useCallback, useState } from "react";
import { useOrchestrator } from "./hooks/useOrchestrator";
import Header from "./components/Header";
import TaskInput from "./components/TaskInput";
import VoiceInput from "./components/VoiceInput";
import PlanView from "./components/PlanView";
import ApprovalModal from "./components/ApprovalModal";
import EmptyState from "./components/EmptyState";

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

  const handleSelectExample = useCallback((text: string) => {
    setGoalText(text);
  }, []);

  return (
    <div className="app">
      <Header connected={connected} onReconnect={reconnect} />

      <main className="app-main">
        {!isExecuting && !currentPlan && (
          <EmptyState onSelectExample={handleSelectExample} />
        )}

        {(isExecuting || currentPlan) && (
          <>
            {isExecuting && !currentPlan && (
              <div className="loading">
                <p>Generating plan...</p>
                <div className="loading-shimmer" />
              </div>
            )}

            <PlanView plan={currentPlan} />
          </>
        )}
      </main>

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
