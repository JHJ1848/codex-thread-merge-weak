import { existsSync } from "node:fs";
import path from "node:path";
import type {
  AppServerThread,
  AppServerThreadListResult,
  AppServerThreadReadResult,
  AppServerTurn,
  JsonObject,
  JsonValue,
} from "../shared/types.js";
import {
  AppServerProcessTransport,
  type AppServerProcessOptions,
} from "./process-transport.js";

export interface CodexAppServerClientOptions {
  process: AppServerProcessOptions;
  initialize?: {
    clientName?: string;
    clientVersion?: string;
  };
}

export interface ThreadListParams {
  cursor?: string;
  archived?: boolean;
  limit?: number;
  sourceKinds?: string[];
  modelProviders?: string[];
}

export interface ThreadReadParams {
  threadId: string;
  includeTurns?: boolean;
}

export interface ThreadStartParams {
  cwd?: string;
}

export interface ThreadResumeParams {
  threadId: string;
  cwd?: string;
}

export interface TurnStartParams {
  threadId: string;
  text: string;
}

export interface ThreadCompactParams {
  threadId: string;
}

export interface ThreadNameSetParams {
  threadId: string;
  name: string;
}

export function resolveCodexAppServerProcess(cwd?: string): AppServerProcessOptions {
  const env = { ...process.env };
  const resolvedCwd = cwd ?? process.cwd();

  if (process.platform === "win32") {
    const nodeScriptCandidates = [
      process.env.APPDATA
        ? path.join(
            process.env.APPDATA,
            "npm",
            "node_modules",
            "@openai",
            "codex",
            "bin",
            "codex.js",
          )
        : null,
      process.env.USERPROFILE
        ? path.join(
            process.env.USERPROFILE,
            "AppData",
            "Roaming",
            "npm",
            "node_modules",
            "@openai",
            "codex",
            "bin",
            "codex.js",
          )
        : null,
    ];
    for (const script of nodeScriptCandidates) {
      if (!script || !existsSync(script)) {
        continue;
      }
      return {
        command: process.execPath,
        args: [script, "app-server"],
        cwd: resolvedCwd,
        env,
      };
    }

    const powershellCandidates = [
      process.env.SystemRoot
        ? path.join(
            process.env.SystemRoot,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
          )
        : null,
      "powershell.exe",
    ];
    const scriptCandidates = [
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "codex.ps1") : null,
      process.env.USERPROFILE
        ? path.join(process.env.USERPROFILE, "AppData", "Roaming", "npm", "codex.ps1")
        : null,
    ];

    for (const powershell of powershellCandidates) {
      if (!powershell) {
        continue;
      }
      if (powershell.includes(path.sep) && !existsSync(powershell)) {
        continue;
      }
      for (const script of scriptCandidates) {
        if (!script || !existsSync(script)) {
          continue;
        }
        return {
          command: powershell,
          args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "app-server"],
          cwd: resolvedCwd,
          env,
        };
      }
    }

    const candidates = [
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "codex.cmd") : null,
      process.env.USERPROFILE
        ? path.join(process.env.USERPROFILE, "AppData", "Roaming", "npm", "codex.cmd")
        : null,
      "codex.cmd",
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (candidate.includes(path.sep) && !existsSync(candidate)) {
        continue;
      }
      return {
        command: process.env.COMSPEC ?? "cmd.exe",
        args: ["/d", "/s", "/c", `"${candidate}" app-server`],
        cwd: resolvedCwd,
        env,
      };
    }
  }

  return {
    command: "codex",
    args: ["app-server"],
    cwd: resolvedCwd,
    env,
  };
}

export class CodexAppServerClient {
  private readonly transport: AppServerProcessTransport;

  private readonly initPromise: Promise<void>;

  public constructor(options: CodexAppServerClientOptions) {
    this.transport = new AppServerProcessTransport(options.process);
    this.initPromise = this.initialize(options.initialize);
  }

  public async listThreads(params: ThreadListParams = {}): Promise<AppServerThreadListResult> {
    await this.initPromise;
    const raw = await this.transport.request<JsonValue>(
      "thread/list",
      toJsonObject({
        cursor: params.cursor ?? null,
        archived: params.archived ?? null,
        limit: params.limit ?? null,
        sourceKinds: params.sourceKinds ?? null,
        modelProviders: params.modelProviders ?? null,
      }),
    );
    const response = asObject(raw);
    return {
      threads: asArray(response.data).map((value) =>
        normalizeThread(asObject(value), params.archived ?? false),
      ),
      nextCursor: asString(response.nextCursor),
    };
  }

  public async readThread(params: ThreadReadParams): Promise<AppServerThreadReadResult> {
    await this.initPromise;
    const raw = await this.transport.request<JsonValue>(
      "thread/read",
      toJsonObject({
        threadId: params.threadId,
        includeTurns: params.includeTurns ?? false,
      }),
    );
    const response = asObject(raw);
    if (!isObject(response.thread)) {
      throw new Error("thread/read returned no thread payload.");
    }

    return {
      thread: normalizeThread(response.thread, false),
    };
  }

  public async startThread(params: ThreadStartParams = {}): Promise<AppServerThread> {
    await this.initPromise;
    const raw = await this.transport.request<JsonValue>(
      "thread/start",
      toJsonObject({
        cwd: params.cwd ?? null,
        experimentalRawEvents: false,
        // Some Codex hosts still gate richer persisted history behind experimental APIs.
        // Keep canonical thread creation on the stable path so merge works broadly.
        persistExtendedHistory: false,
      }),
    );
    const response = asObject(raw);
    if (!isObject(response.thread)) {
      throw new Error("thread/start returned no thread payload.");
    }
    return normalizeThread(response.thread, false);
  }

  public async resumeThread(params: ThreadResumeParams): Promise<AppServerThread> {
    await this.initPromise;
    const raw = await this.transport.request<JsonValue>(
      "thread/resume",
      toJsonObject({
        threadId: params.threadId,
        cwd: params.cwd ?? null,
        persistExtendedHistory: false,
      }),
    );
    const response = asObject(raw);
    if (!isObject(response.thread)) {
      throw new Error("thread/resume returned no thread payload.");
    }
    return normalizeThread(response.thread, false);
  }

  public async startTurn(params: TurnStartParams): Promise<AppServerTurn> {
    await this.initPromise;
    const raw = await this.transport.request<JsonValue>(
      "turn/start",
      toJsonObject({
        threadId: params.threadId,
        input: [{ type: "text", text: params.text, text_elements: [] }],
      }),
    );
    const response = asObject(raw);
    if (!isObject(response.turn)) {
      throw new Error("turn/start returned no turn payload.");
    }
    return normalizeTurn(response.turn);
  }

  public async compactThread(params: ThreadCompactParams): Promise<void> {
    await this.initPromise;
    await this.transport.request<JsonValue>(
      "thread/compact/start",
      toJsonObject({ threadId: params.threadId }),
    );
  }

  public async setThreadName(params: ThreadNameSetParams): Promise<void> {
    await this.initPromise;
    await this.transport.request<JsonValue>(
      "thread/name/set",
      toJsonObject({ threadId: params.threadId, name: params.name }),
    );
  }

  public close(): void {
    this.transport.close();
  }

  private async initialize(init?: {
    clientName?: string;
    clientVersion?: string;
  }): Promise<void> {
    await this.transport.request<JsonValue>(
      "initialize",
      toJsonObject({
        clientInfo: {
          name: init?.clientName ?? "thread-merge-mcp",
          title: init?.clientName ?? "thread-merge-mcp",
          version: init?.clientVersion ?? "0.1.0",
        },
        capabilities: {
          experimentalApi: false,
          optOutNotificationMethods: [
            "thread/started",
            "turn/started",
            "item/agentMessage/delta",
            "item/reasoning/textDelta",
            "item/reasoning/summaryTextDelta",
          ],
        },
      }),
    );
    this.transport.notify("initialized");
  }
}

function normalizeThread(raw: JsonObject, archivedFallback: boolean): AppServerThread {
  return {
    id: asRequiredString(raw.id, "thread.id"),
    name: asString(raw.name),
    preview: asString(raw.preview) ?? undefined,
    cwd: asString(raw.cwd),
    archived: asBoolean(raw.archived) ?? archivedFallback,
    status: normalizeStatus(raw.status),
    createdAt: normalizeTimestamp(raw.createdAt),
    updatedAt: normalizeTimestamp(raw.updatedAt),
    turns: asArray(raw.turns).map((value) => normalizeTurn(asObject(value))),
  };
}

function normalizeTurn(raw: JsonObject): AppServerTurn {
  return {
    id: asRequiredString(raw.id, "turn.id"),
    status: normalizeStatus(raw.status),
    items: asArray(raw.items).map((value) => asObject(value)),
  };
}

function normalizeTimestamp(value: JsonValue | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return null;
}

function normalizeStatus(value: JsonValue | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (isObject(value) && typeof value.type === "string") {
    return value.type;
  }
  return undefined;
}

function toJsonObject(value: Record<string, JsonValue | undefined | null>): JsonObject {
  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      output[key] = entry;
    }
  }
  return output;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: JsonValue): JsonObject {
  if (!isObject(value)) {
    throw new Error("Expected JSON object from app-server.");
  }
  return value;
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asBoolean(value: JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asRequiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  throw new Error(`Missing ${label} in app-server response.`);
}
