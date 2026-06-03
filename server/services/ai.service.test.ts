/**
 * aiService.revealApiKey - unit test
 *
 * Scheme A: when clicking the "show" button in the AI settings panel, the app
 * must fetch the stored plaintext apiKey on demand and backfill the input box.
 * This verifies the new service-layer revealApiKey():
 *   - stored key -> returns plaintext
 *   - no key     -> returns null
 *   - getSettingsView still only exposes hasApiKey, never leaking plaintext
 */
import { describe, expect, it } from "vitest";
import { makeAiService, type PublicStorage, type SecretStorage } from "./ai.service.js";
import { DEFAULT_PUBLIC_AI_SETTINGS } from "../../shared/ai/types.js";

function makeMockStorage(opts: { apiKey?: string | null } = {}): {
  secret: SecretStorage;
  pub: PublicStorage;
} {
  let stored = opts.apiKey ?? null;
  const secret: SecretStorage = {
    async getApiKey() {
      return stored;
    },
    async saveApiKey(plain) {
      stored = plain;
    },
  };
  const pub: PublicStorage = {
    async read() {
      return { ...DEFAULT_PUBLIC_AI_SETTINGS };
    },
    async write() {
      /* no-op */
    },
  };
  return { secret, pub };
}

describe("aiService.revealApiKey", () => {
  it("stored key -> returns plaintext", async () => {
    const { secret, pub } = makeMockStorage({ apiKey: "sk-secret-123" });
    const svc = makeAiService({ secretStorage: secret, publicStorage: pub });
    expect(await svc.revealApiKey()).toBe("sk-secret-123");
  });

  it("no key -> returns null", async () => {
    const { secret, pub } = makeMockStorage({ apiKey: null });
    const svc = makeAiService({ secretStorage: secret, publicStorage: pub });
    expect(await svc.revealApiKey()).toBeNull();
  });

  it("getSettingsView still only exposes hasApiKey, no plaintext", async () => {
    const { secret, pub } = makeMockStorage({ apiKey: "sk-secret-123" });
    const svc = makeAiService({ secretStorage: secret, publicStorage: pub });
    const view = await svc.getSettingsView();
    expect(view.hasApiKey).toBe(true);
    expect((view as unknown as Record<string, unknown>).apiKey).toBeUndefined();
  });
});
