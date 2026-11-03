import { derived, get } from "svelte/store";
import { settings } from "./config";
import { tr } from "./i18n/tr";
import type { Key } from "./i18n/tr";
import { en } from "./i18n/en";

export type Lang = "tr" | "en";
export type { Key };

const dicts: Record<Lang, Partial<Record<Key, string>>> = { tr, en };

// Sistem dili Türkçe ise Türkçe, diğer her durumda İngilizce
export function systemLang(): Lang {
  const n = typeof navigator !== "undefined" ? navigator.language : "";
  return n.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export const lang = derived(settings, ($s): Lang =>
  $s.language === "auto" ? systemLang() : $s.language
);

export type TFn = (key: Key, vars?: Record<string, string | number>) => string;

// Svelte içinde: {$t("tab.general")}   Normal kodda: tn("tab.general")
export const t = derived(lang, ($l): TFn => (key, vars) => {
  let s = dicts[$l][key] ?? tr[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return s;
});

export const tn: TFn = (key, vars) => get(t)(key, vars);
