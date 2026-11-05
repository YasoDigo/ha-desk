import { derived } from "svelte/store";
import { settings } from "./config";
import { setLang, translate, systemLang } from "./i18n/core";
import type { Lang, TFn, Key } from "./i18n/core";

export type { Lang, TFn, Key };
export { tn, locale, hasKey, systemLang } from "./i18n/core";

export const lang = derived(settings, ($s): Lang =>
  $s.language === "auto" ? systemLang() : $s.language
);
// Çekirdeğin güncel dilini ayarlarla eşler (abonelik bu modül yüklenince başlar)
lang.subscribe(setLang);

// Svelte içinde: {$t("tab.general")}
export const t = derived(lang, ($l): TFn => (key, vars) => translate($l, key, vars));
