/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    selectDirectory(): Promise<string | null>;
  };
}

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
