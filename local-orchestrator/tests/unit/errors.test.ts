import { describe, it, expect } from "vitest";
import {
  GemorkError,
  LLMError,
  ConnectorError,
  GuardrailError,
  StorageError,
  SnapshotError,
  isGemorkError,
  isLLMError,
  isConnectorError,
  isGuardrailError,
  isStorageError,
  isSnapshotError,
} from "../../src/errors.js";

describe("errors", () => {
  describe("GemorkError", () => {
    it("creates base error with code and module", () => {
      const err = new GemorkError("TEST_CODE", "test message", { module: "test" });
      expect(err.code).toBe("TEST_CODE");
      expect(err.message).toBe("test message");
      expect(err.module).toBe("test");
      expect(err.recoverable).toBe(true);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(GemorkError);
    });

    it("defaults to unknown module and recoverable", () => {
      const err = new GemorkError("CODE", "msg");
      expect(err.module).toBe("unknown");
      expect(err.recoverable).toBe(true);
    });

    it("accepts context and cause", () => {
      const cause = new Error("original");
      const err = new GemorkError("CODE", "msg", {
        module: "m",
        recoverable: false,
        context: { key: "val" },
        cause,
      });
      expect(err.recoverable).toBe(false);
      expect(err.context).toEqual({ key: "val" });
      expect(err.cause).toBe(cause);
    });
  });

  describe("LLMError", () => {
    it("creates LLM error with llmCode", () => {
      const err = new LLMError("LLM_TIMEOUT", "timed out");
      expect(err.llmCode).toBe("LLM_TIMEOUT");
      expect(err.module).toBe("llm");
      expect(err.name).toBe("LLMError");
    });
  });

  describe("ConnectorError", () => {
    it("creates connector error with connectorId", () => {
      const err = new ConnectorError("CONNECTOR_API_FAILURE", "google-drive", "API failed");
      expect(err.connectorCode).toBe("CONNECTOR_API_FAILURE");
      expect(err.connectorId).toBe("google-drive");
      expect(err.module).toBe("connector");
      expect(err.context).toEqual({ connectorId: "google-drive" });
    });
  });

  describe("GuardrailError", () => {
    it("creates guardrail error with guardrailCode", () => {
      const err = new GuardrailError("GUARDRAIL_PERMISSION_DENIED", "denied");
      expect(err.guardrailCode).toBe("GUARDRAIL_PERMISSION_DENIED");
      expect(err.module).toBe("guardrails");
      expect(err.recoverable).toBe(false);
    });
  });

  describe("StorageError", () => {
    it("creates storage error with storageCode", () => {
      const err = new StorageError("STORAGE_DISK_FULL", "no space");
      expect(err.storageCode).toBe("STORAGE_DISK_FULL");
      expect(err.module).toBe("storage");
    });
  });

  describe("SnapshotError", () => {
    it("creates snapshot error with snapshotCode", () => {
      const err = new SnapshotError("SNAPSHOT_BACKUP_FAILED", "backup failed");
      expect(err.snapshotCode).toBe("SNAPSHOT_BACKUP_FAILED");
      expect(err.module).toBe("snapshot");
    });
  });

  describe("type guards", () => {
    it("isGemorkError detects GemorkError", () => {
      expect(isGemorkError(new GemorkError("X", "y"))).toBe(true);
      expect(isGemorkError(new Error("y"))).toBe(false);
      expect(isGemorkError(null)).toBe(false);
    });

    it("isLLMError detects LLMError", () => {
      expect(isLLMError(new LLMError("LLM_TIMEOUT", "x"))).toBe(true);
      expect(isLLMError(new GemorkError("X", "y"))).toBe(false);
    });

    it("isConnectorError detects ConnectorError", () => {
      expect(isConnectorError(new ConnectorError("CONNECTOR_API_FAILURE", "id", "x"))).toBe(true);
      expect(isConnectorError(new GemorkError("X", "y"))).toBe(false);
    });

    it("isGuardrailError detects GuardrailError", () => {
      expect(isGuardrailError(new GuardrailError("GUARDRAIL_PERMISSION_DENIED", "x"))).toBe(true);
      expect(isGuardrailError(new GemorkError("X", "y"))).toBe(false);
    });

    it("isStorageError detects StorageError", () => {
      expect(isStorageError(new StorageError("STORAGE_DISK_FULL", "x"))).toBe(true);
      expect(isStorageError(new GemorkError("X", "y"))).toBe(false);
    });

    it("isSnapshotError detects SnapshotError", () => {
      expect(isSnapshotError(new SnapshotError("SNAPSHOT_BACKUP_FAILED", "x"))).toBe(true);
      expect(isSnapshotError(new GemorkError("X", "y"))).toBe(false);
    });

    it("all errors are instances of GemorkError", () => {
      expect(isGemorkError(new LLMError("LLM_TIMEOUT", "x"))).toBe(true);
      expect(isGemorkError(new ConnectorError("CONNECTOR_API_FAILURE", "id", "x"))).toBe(true);
      expect(isGemorkError(new GuardrailError("GUARDRAIL_PERMISSION_DENIED", "x"))).toBe(true);
      expect(isGemorkError(new StorageError("STORAGE_DISK_FULL", "x"))).toBe(true);
      expect(isGemorkError(new SnapshotError("SNAPSHOT_BACKUP_FAILED", "x"))).toBe(true);
    });
  });
});
