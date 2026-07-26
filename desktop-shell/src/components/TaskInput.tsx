import { useState } from "react";

interface TaskInputProps {
  onSubmit: (goal: string) => void;
  disabled: boolean;
}

function TaskInput({ onSubmit, disabled }: TaskInputProps) {
  const [goal, setGoal] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (goal.trim() && !disabled) {
      onSubmit(goal.trim());
      setGoal("");
    }
  };

  return (
    <form className="task-input" onSubmit={handleSubmit}>
      <div className="task-input-row">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="What do you want to accomplish?"
          disabled={disabled}
          rows={3}
        />
        <button
          type="button"
          className="voice-btn"
          disabled
          title="Voice input (coming soon)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
      </div>
      <button
        type="submit"
        className="start-btn"
        disabled={disabled || !goal.trim()}
      >
        {disabled ? "Working..." : "Start"}
      </button>
    </form>
  );
}

export default TaskInput;
