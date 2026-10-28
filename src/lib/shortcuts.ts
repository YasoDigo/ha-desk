import { get, writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { register, unregister, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { ha, entities, status } from "./ha";
import { shortcuts } from "./config";
import type { Action } from "./config";
import { kindOf, domainOf, pctOf, setPct, press } from "./tileKind";

// ---------- arayüz için yardımcılar ----------

export type ActionKind = "toggle" | "on" | "off" | "run" | "inc" | "dec" | "set" | "popup" | "palette";

export const ACTION_OPTIONS: [ActionKind, string][] = [
  ["toggle", "Aç/Kapat"],
  ["on", "Aç"],
  ["off", "Kapat"],
  ["run", "Çalıştır (sahne/script/otomasyon/buton)"],
  ["inc", "Artır (+)"],
  ["dec", "Azalt (−)"],
  ["set", "Değer ata"],
  ["popup", "Popup'ı aç/kapat"],
  ["palette", "Komut paletini aç/kapat"],
];

export const actionKind = (a: Action): ActionKind =>
  a.type === "adjust" ? (a.delta >= 0 ? "inc" : "dec") : a.type;

export const needsEntity = (a: Action) => a.type !== "popup" && a.type !== "palette";
export const entityOf = (a: Action) => ("entity_id" in a ? a.entity_id : "");
export const stepOf = (a: Action) => (a.type === "adjust" ? Math.abs(a.delta) : 10);
export const valueOf = (a: Action) => (a.type === "set" ? a.value : 50);

export function prettyKeys(keys: string): string {
  return keys
    .replace(/Key([A-Z])/g, "$1")
    .replace(/Digit(\d)/g, "$1")
    .replace(/Arrow/g, "");
}

const MOD_ORDER = ["ctrl", "alt", "shift", "super"];
const MOD_ALIAS: Record<string, string> = {
  control: "ctrl", option: "alt", meta: "super", win: "super",
  cmd: "super", command: "super", commandorcontrol: "ctrl", cmdorctrl: "ctrl",
};

// "Shift+Ctrl+KeyA" ile "Ctrl+Shift+KeyA" aynı kombinasyondur
export function normKeys(keys: string): string {
  const mods = new Set<string>();
  let key = "";
  for (const p of keys.split("+").map((x) => x.trim()).filter(Boolean)) {
    const l = MOD_ALIAS[p.toLowerCase()] ?? p.toLowerCase();
    if (MOD_ORDER.includes(l)) mods.add(l);
    else key = l;
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join("+");
}

// Aynı tuş başka bir kısayolda varsa onun sırasını (0'dan) döner, yoksa -1
export function conflictIndex(keys: string, exceptId: string | null): number {
  const n = normKeys(keys);
  return get(shortcuts).findIndex((s) => s.id !== exceptId && s.keys && normKeys(s.keys) === n);
}

function withKind(a: Action, k: ActionKind): Action {
  const ent = entityOf(a);
  switch (k) {
    case "popup":
    case "palette":
      return { type: k };
    case "inc":
      return { type: "adjust", entity_id: ent, delta: stepOf(a) };
    case "dec":
      return { type: "adjust", entity_id: ent, delta: -stepOf(a) };
    case "set":
      return { type: "set", entity_id: ent, value: valueOf(a) };
    default:
      return { type: k, entity_id: ent };
  }
}

export function addShortcut() {
  shortcuts.update((l) => [
    ...l,
    { id: crypto.randomUUID(), keys: "", action: { type: "toggle", entity_id: "" } },
  ]);
}

export function removeShortcut(id: string) {
  shortcuts.update((l) => l.filter((s) => s.id !== id));
}

export function patchShortcut(id: string, patch: { keys?: string }) {
  shortcuts.update((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

const mapAction = (id: string, fn: (a: Action) => Action) =>
  shortcuts.update((l) => l.map((s) => (s.id === id ? { ...s, action: fn(s.action) } : s)));

export const setKind = (id: string, k: ActionKind) => mapAction(id, (a) => withKind(a, k));
export const setEntity = (id: string, entity_id: string) =>
  mapAction(id, (a) => ("entity_id" in a ? ({ ...a, entity_id } as Action) : a));
export const setStep = (id: string, n: number) =>
  mapAction(id, (a) =>
    a.type === "adjust" ? { ...a, delta: (a.delta < 0 ? -1 : 1) * Math.abs(n) } : a
  );
export const setValue = (id: string, n: number) =>
  mapAction(id, (a) => (a.type === "set" ? { ...a, value: n } : a));

// ---------- eylemleri çalıştırma ----------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Tuşa basılı tutunca HA'dan durum gecikmeli geldiği için son hedefi hatırlıyoruz.
const pending = new Map<string, { v: number; t: number }>();
const baseOf = (id: string, current: number) => {
  const p = pending.get(id);
  return p && Date.now() - p.t < 1500 ? p.v : current;
};

async function runAction(a: Action): Promise<unknown> {
  if (a.type === "popup") return invoke("toggle_popup");
  if (a.type === "palette") return invoke("toggle_palette");
  if (get(status) !== "connected") return;

  const e = get(entities)[a.entity_id];
  const d = domainOf(a.entity_id);

  switch (a.type) {
    case "toggle":
      return ha.callService("homeassistant", "toggle", a.entity_id);
    case "on":
      return ha.callService("homeassistant", "turn_on", a.entity_id);
    case "off":
      return ha.callService("homeassistant", "turn_off", a.entity_id);
    case "run":
      return e ? press(e) : undefined;
    case "adjust":
    case "set": {
      if (!e) return;
      const k = kindOf(e);
      if (k === "dimmer") {
        const target =
          a.type === "set"
            ? clamp(a.value, 0, 100)
            : clamp(baseOf(a.entity_id, pctOf(e)) + a.delta, 0, 100);
        pending.set(a.entity_id, { v: target, t: Date.now() });
        return setPct(e, target);
      }
      if (k === "number") {
        const min = Number(e.attributes.min ?? 0);
        const max = Number(e.attributes.max ?? 100);
        const cur = Number.isFinite(Number(e.state)) ? Number(e.state) : min;
        const target =
          a.type === "set"
            ? clamp(a.value, min, max)
            : clamp(baseOf(a.entity_id, cur) + a.delta, min, max);
        pending.set(a.entity_id, { v: target, t: Date.now() });
        return ha.callService(d, "set_value", a.entity_id, { value: target });
      }
    }
  }
}

// ---------- global kısayol kaydı ----------

export const shortcutErrors = writable<Record<string, string>>({});

let paused = false;
let again = false;
let inflight: Promise<void> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

async function doSync() {
  try {
    await unregisterAll();
  } catch {}
  const errs: Record<string, string> = {};
  const seen = new Map<string, number>();
  const list = get(shortcuts);
  for (let i = 0; i < list.length; i++) {
    if (paused) return;
    const s = list[i];
    if (!s.keys) continue;
    if (needsEntity(s.action) && !entityOf(s.action)) continue;
    const n = normKeys(s.keys);
    if (seen.has(n)) {
      errs[s.id] = `Bu tuş kısayol #${seen.get(n)! + 1} ile aynı`;
      continue;
    }
    seen.set(n, i);
    try {
      try { await unregister(s.keys); } catch {}
      await register(s.keys, (ev) => {
        if (ev.state !== "Pressed") return;
        runAction(s.action).catch((e) => console.error("Kısayol hatası", e));
      });
    } catch (e) {
      errs[s.id] = String(e);
    }
  }
  shortcutErrors.set(errs);
}

// Aynı anda tek kayıt turu çalışır; çalışırken gelen istek turun bitince bir kez daha koşar
function syncShortcuts(): Promise<void> {
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    try {
      do {
        again = false;
        await doSync();
      } while (again && !paused);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function startShortcuts() {
  shortcuts.subscribe(() => {
    if (paused) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(syncShortcuts, 400);
  });
}

// Tuş kaydederken mevcut kısayollar tuşu yutmasın diye geçici olarak kapatılır
export async function pauseShortcuts() {
  paused = true;
  if (syncTimer) clearTimeout(syncTimer);
  if (inflight) await inflight;
  try {
    await unregisterAll();
  } catch {}
}

export async function resumeShortcuts() {
  paused = false;
  await syncShortcuts();
}
