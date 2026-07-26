import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceInput } from "../hooks/useVoiceInput";

interface VoiceInputProps {
  onTranscription: (text: string) => void;
  disabled: boolean;
}

function VoiceInput({ onTranscription, disabled }: VoiceInputProps) {
  const {
    isListening,
    startListening,
    stopListening,
    cancel,
    transcription,
    error,
  } = useVoiceInput();

  const [isPressed, setIsPressed] = useState(false);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (transcription) {
      onTranscription(transcription);
    }
  }, [transcription, onTranscription]);

  const handleMouseDown = useCallback(async () => {
    if (disabled || isListening) return;

    setIsPressed(true);
    pressTimerRef.current = setTimeout(async () => {
      try {
        await startListening();
      } catch {
        setIsPressed(false);
      }
    }, 150);
  }, [disabled, isListening, startListening]);

  const handleMouseUp = useCallback(async () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }

    if (isListening) {
      setIsPressed(false);
      await stopListening();
    } else {
      setIsPressed(false);
    }
  }, [isListening, stopListening]);

  const handleMouseLeave = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }

    if (isListening) {
      cancel();
      setIsPressed(false);
    }
  }, [isListening, cancel]);

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
    };
  }, []);

  const buttonClass = [
    "voice-btn",
    isListening && "voice-btn-recording",
    isPressed && "voice-btn-pressed",
    disabled && "voice-btn-disabled",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="voice-input-container">
      <button
        type="button"
        className={buttonClass}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        disabled={disabled}
        title={
          isListening
            ? "Release to stop recording"
            : disabled
              ? "Voice input unavailable"
              : "Hold to speak"
        }
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
        {isListening && <span className="voice-recording-dot" />}
      </button>
      {error && <span className="voice-error">{error}</span>}
    </div>
  );
}

export default VoiceInput;
