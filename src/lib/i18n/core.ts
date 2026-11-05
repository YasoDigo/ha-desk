// Dil çekirdeği: ayarlara bağımlı değil, her modülden güvenle içe aktarılır (döngü olmaz).
import { tr } from "./tr";
import type { Key } from "./tr";
import { en } from "./en";

export type Lang = "tr" | "en";
export type { Key };
export type TFn = (key: Key, vars?: Record<string, string | number>) => string;

const dicts: Record<Lang, Partial<Record<Key, string>>> = { tr, en };

// Sistem dili Türkçe ise Türkçe, diğer her durumda İngilizce
export function systemLang(): Lang {
  const n = typeof navigator !== "undefined" ? navigator.language : "";
  return n.toLowerCase().startsWith("tr") ? "tr" : "en";
}

let current: Lang = systemLang();
export const setLang = (l: Lang) => {
  current = l;
};
export const locale = () => (current === "tr" ? "tr-TR" : "en-US");

export const hasKey = (k: string): k is Key => k in tr;

export function translate(l: Lang, key: Key, vars?: Record<string, string | number>): string {
  let s = dicts[l][key] ?? tr[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return s;
}

// Store kullanmayan yerler için (ha.ts, notify.ts, tileKind.ts gibi)
export const tn: TFn = (key, vars) => translate(current, key, vars);
