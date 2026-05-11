import { createI18n } from "vue-i18n";
import zhCN from "./locales/zh-CN";
import enUS from "./locales/en-US";

export type SupportedLocale = "zh-CN" | "en-US";

const LOCALE_KEY = "git-manager.locale";

function detectLocale(): SupportedLocale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === "zh-CN" || saved === "en-US") return saved;
  } catch {
    // localStorage 不可用（SSR / 隐私模式）
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  if (nav.toLowerCase().startsWith("zh")) return "zh-CN";
  return "en-US";
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: "zh-CN",
  messages: {
    "zh-CN": zhCN,
    "en-US": enUS,
  },
});

export function setLocale(locale: SupportedLocale) {
  i18n.global.locale.value = locale;
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // 静默
  }
}

export function getLocale(): SupportedLocale {
  return i18n.global.locale.value as SupportedLocale;
}
