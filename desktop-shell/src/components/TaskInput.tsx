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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form className="task-input" onSubmit={handleSubmit}>
      <div className="task-input-inner">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you want to accomplish..."
          disabled={disabled}
          rows={3}
          aria-label="Task description"
        />
        <div className="task-input-footer">
          <span className="task-char-count">
            {value.length > 0 ? `${value.length} characters` : ""}
          </span>
          <button
            type="submit"
            className="start-btn"
            disabled={disabled || !value.trim()}
          >
            {disabled ? (
              <>
                <span className="spinner" />
                Working...
              </>
            ) : (
              <>
                Start
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}

export default TaskInput;
