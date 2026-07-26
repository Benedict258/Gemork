import { useState } from "react";
import TaskInput from "./components/TaskInput";
import PlanView from "./components/PlanView";

interface PlanStep {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  tier: 1 | 2 | 3;
}

function App() {
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Gemork</h1>
        <span className="subtitle">Cowork with Gemma</span>
      </header>

      <main className="app-main">
        <TaskInput
          onSubmit={(goal) => {
            console.log("Goal submitted:", goal);
            setIsExecuting(true);
          }}
          disabled={isExecuting}
        />

        {plan.length > 0 && <PlanView steps={plan} />}

        {isExecuting && plan.length === 0 && (
          <div className="loading">
            <p>Generating plan...</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
