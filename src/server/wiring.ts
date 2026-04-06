import {
  CodexAppServerClient,
  resolveCodexAppServerProcess,
} from "../codex-client/client.js";
import {
  MergeProjectThreadsUseCaseImpl,
  PreviewProjectThreadsUseCaseImpl,
  RefreshProjectMemoryUseCaseImpl,
  type MergeProjectThreadsUseCase,
  type PreviewProjectThreadsUseCase,
  type RefreshProjectMemoryUseCase,
} from "./use-cases.js";

export interface ServerUseCases {
  previewProjectThreads: PreviewProjectThreadsUseCase;
  mergeProjectThreads: MergeProjectThreadsUseCase;
  refreshProjectMemory: RefreshProjectMemoryUseCase;
}

function createCodexClient(cwd: string): CodexAppServerClient {
  return new CodexAppServerClient({
    process: resolveCodexAppServerProcess(cwd),
    initialize: {
      clientName: "codex-thread-merge-mcp",
      clientVersion: "0.1.0",
    },
  });
}

export function createDefaultUseCases(): ServerUseCases {
  return {
    previewProjectThreads: new PreviewProjectThreadsUseCaseImpl({ createCodexClient }),
    mergeProjectThreads: new MergeProjectThreadsUseCaseImpl({ createCodexClient }),
    refreshProjectMemory: new RefreshProjectMemoryUseCaseImpl({ createCodexClient }),
  };
}
