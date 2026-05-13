import type { Commands, Platform } from "./types";
import { COMMANDS } from "../../shared/command-manifest";

export function createElectronAdapter(): Commands {
  const api = window.electronAPI!;
  const out: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const spec of COMMANDS) {
    out[spec.method] = (...args: unknown[]) => api.invoke(spec.ipc, ...args);
  }
  return out as unknown as Commands;
}

export function createElectronPlatform(): Platform {
  return {
    isElectron: true,
    selectDirectory: () => window.electronAPI!.selectDirectory(),
  };
}
