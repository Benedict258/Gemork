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
    }
  };

  return (
    <form className="task-input" onSubmit={handleSubmit}>
      <textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="What do you want to accomplish?"
        disabled={disabled}
        rows={3}
      />
      <button type="submit" disabled={disabled || !goal.trim()}>
        {disabled ? "Working..." : "Start"}
      </button>
    </form>
  );
}

export default TaskInput;
