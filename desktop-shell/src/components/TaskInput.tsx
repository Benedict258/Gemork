interface TaskInputProps {
  onSubmit: (goal: string) => void;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}

function TaskInput({ onSubmit, disabled, value, onChange }: TaskInputProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() && !disabled) {
      onSubmit(value.trim());
      onChange("");
    }
  };

  return (
    <form className="task-input" onSubmit={handleSubmit}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What do you want to accomplish?"
        disabled={disabled}
        rows={3}
      />
      <button
        type="submit"
        className="start-btn"
        disabled={disabled || !value.trim()}
      >
        {disabled ? "Working..." : "Start"}
      </button>
    </form>
  );
}

export default TaskInput;
