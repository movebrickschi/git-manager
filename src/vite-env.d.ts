/// <reference types="vite/client" />

import type { TypedInvoke } from "../shared/typed-ipc";

declare global {
  /** Vite define 注入的应用版本号（来源 package.json version，构建期文本替换）。 */
  const __APP_VERSION__: string;

  interface Window {
    electronAPI?: {
      /** 类型化 IPC invoke：channel 字面量 → 自动推断 args/return；string 兜底 → unknown。 */
      invoke: TypedInvoke;
      selectDirectory(): Promise<string | null>;
      revealInFolder(absPath: string): Promise<void>;
      on?(channel: string, callback: (payload: any) => void): () => void;
    };
  }
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, any>;
  export default component;
}

export {};

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, any>;
  export default component;
}

declare module "splitpanes" {
  import type { DefineComponent } from "vue";
  export const Splitpanes: DefineComponent<any, any, any>;
  export const Pane: DefineComponent<any, any, any>;
}
