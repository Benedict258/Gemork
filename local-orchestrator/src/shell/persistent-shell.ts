/**
 * Persistent Shell — keeps one shell session alive for the agent
 * Commands are sent through stdin, output read from stdout
 */
import { spawn, type ChildProcess } from "child_process";

export class PersistentShell {
  private process: ChildProcess | null = null;
  private output: string[] = [];
  private ready = false;

  async start(): Promise<void> {
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "powershell.exe" : "bash";

    this.process = spawn(shell, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb" },
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.output.push(data.toString());
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      this.output.push(data.toString());
    });

    this.process.on("exit", () => {
      this.ready = false;
    });

    // Wait for shell to be ready
    await new Promise(r => setTimeout(r, 500));
    this.ready = true;
  }

  async execute(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.ready || !this.process?.stdin) {
      throw new Error("Shell not ready");
    }

    this.output = [];
    const marker = `__GEMORK_DONE_${Date.now()}__`;

    // Send command with marker to detect completion
    const isWindows = process.platform === "win32";
    const fullCommand = isWindows
      ? `${command}; echo ${marker}`
      : `${command}; echo ${marker}`;

    this.process.stdin.write(fullCommand + "\n");

    // Wait for marker to appear in output
    const startTime = Date.now();
    const timeout = 30000;

    while (Date.now() - startTime < timeout) {
      await new Promise(r => setTimeout(r, 100));
      const allOutput = this.output.join("");
      if (allOutput.includes(marker)) {
        // Split at marker
        const parts = allOutput.split(marker);
        const result = parts[0] || "";
        const stderrParts = result.split("\n");
        const lastLine = stderrParts[stderrParts.length - 1];

        return {
          stdout: result.replace(marker, "").trim(),
          stderr: "",
          exitCode: 0,
        };
      }
    }

    return {
      stdout: this.output.join("").trim(),
      stderr: "Command timed out",
      exitCode: 1,
    };
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.ready = false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }
}
