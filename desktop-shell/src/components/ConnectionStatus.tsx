interface ConnectionStatusProps {
  status: "disconnected" | "connected" | "reconnecting";
  onReconnect: () => void;
}

function ConnectionStatus({ status, onReconnect }: ConnectionStatusProps) {
  const dotClass =
    status === "connected"
      ? "status-dot connected"
      : status === "reconnecting"
        ? "status-dot reconnecting"
        : "status-dot disconnected";

  const label =
    status === "connected"
      ? "Connected to Gemork"
      : status === "reconnecting"
        ? "Reconnecting..."
        : "Disconnected";

  return (
    <button className="connection-status" onClick={onReconnect} title="Click to reconnect">
      <span className={dotClass} />
      <span className="status-label">{label}</span>
    </button>
  );
}

export default ConnectionStatus;
