import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { JsonValue } from "../shared/types.js";
import {
  JsonRpcRequestError,
  type JsonRpcErrorResponse,
  type JsonRpcInbound,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcSuccessResponse,
} from "./protocol.js";

type PendingResolver = {
  resolve: (result: JsonValue) => void;
  reject: (error: unknown) => void;
};

export interface AppServerProcessOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export class AppServerProcessTransport {
  private readonly process: ChildProcessWithoutNullStreams;

  private readonly pending = new Map<number, PendingResolver>();

  private readonly stderrLines: string[] = [];

  private nextId = 1;

  private closed = false;

  public constructor(options: AppServerProcessOptions) {
    this.process = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: options.env,
      stdio: "pipe",
      shell: false,
    });

    this.process.once("exit", (code, signal) => {
      this.closed = true;
      const stderrTail = this.stderrLines.slice(-10).join("\n");
      const suffix = stderrTail ? `\nLast stderr:\n${stderrTail}` : "";
      const exitError = new Error(
        `Codex app-server process exited (code=${String(code)}, signal=${String(signal)})${suffix}`,
      );
      this.rejectAllPending(exitError);
    });

    this.process.once("error", (error) => {
      this.closed = true;
      this.rejectAllPending(error);
    });

    const rl = createInterface({ input: this.process.stdout });
    rl.on("line", (line) => this.onStdoutLine(line));

    const errRl = createInterface({ input: this.process.stderr });
    errRl.on("line", (line) => this.onStderrLine(line));
  }

  public async request<T extends JsonValue>(
    method: string,
    params?: Record<string, JsonValue>,
  ): Promise<T> {
    if (this.closed) {
      throw new Error("Codex app-server process is closed.");
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
      });

      const payload = JSON.stringify(request);
      this.process.stdin.write(`${payload}\n`, (error) => {
        if (!error) {
          return;
        }
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  public notify(method: string, params?: Record<string, JsonValue>): void {
    if (this.closed) {
      return;
    }
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    } satisfies JsonRpcNotification);
    this.process.stdin.write(`${payload}\n`);
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rejectAllPending(new Error("Codex app-server transport closed."));
    this.process.kill();
  }

  private rejectAllPending(error: unknown): void {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
  }

  private onStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let parsed: JsonRpcInbound | null = null;
    try {
      parsed = JSON.parse(trimmed) as JsonRpcInbound;
    } catch {
      return;
    }

    if ("id" in parsed) {
      if ("result" in parsed) {
        this.resolveResponse(parsed);
      } else if ("error" in parsed) {
        this.rejectResponse(parsed);
      }
    }
  }

  private onStderrLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    this.stderrLines.push(trimmed);
    if (this.stderrLines.length > 100) {
      this.stderrLines.shift();
    }
  }

  private resolveResponse(response: JsonRpcSuccessResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    pending.resolve(response.result);
  }

  private rejectResponse(response: JsonRpcErrorResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    pending.reject(
      new JsonRpcRequestError(response.error.message, response.error.code, response.error.data),
    );
  }
}
