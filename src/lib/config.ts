import { derived, get, writable } from "svelte/store";
import type { Writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { ha } from "./ha";

export type Tile = { id: string; entity_id: string; span?: 1 | 2 };
export type Group = { id: string; title: string; tiles: Tile[]; master: string[] };

export type Action =
  | { type: "toggle" | "on" | "off" | "run"; entity_id: string }
  | { type: "adjust"; entity_id: string; delta: number }
  | { type: "set"; entity_id: string; value: number }
  | { type: "popup" }
  | { type: "palette" };
export type Shortcut = { id: string; keys: string; action: Action };

export type Settings = {
  connection: { primaryUrl: string; fallbackUrl: string };
  appearance: { theme: "dark" | "light" | "system"; accent: string };
  palette: { sensors: boolean }; // komut paletinde sensörler de aransın mı
};

const VERSION = 1; // ileride format değişirse parse() içinde eski sürümleri buradan taşırız

const defaults: Settings = {
  connection: { primaryUrl: "", fallbackUrl: "" },
  appearance: { theme: "dark", accent: "#f0b429" },
  palette: { sensors: false },
};

const newGroup = (title = ""): Group => ({ id: crypto.randomUUID(), title, tiles: [], master: [] });

export const groups = writable<Group[]>([]);
export const sensorGroups = writable<Group[]>([]);

const idsOf = (gs: Group[]) => new Set(gs.flatMap((g) => g.tiles.map((t) => t.entity_id)));
export const usedEntities = derived(groups, idsOf);
export const usedSensors = derived(sensorGroups, idsOf);

export const shortcuts = writable<Shortcut[]>([]);
export const settings = writable<Settings>(JSON.parse(JSON.stringify(defaults)));

// ---------- okuma / doğrulama ----------

function cleanTiles(list: any): Tile[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && typeof x.entity_id === "string")
    .map((x) => ({
      id: typeof x.id === "string" && x.id ? x.id : crypto.randomUUID(),
      entity_id: x.entity_id as string,
      span: x.span === 2 ? (2 as const) : (1 as const),
    }));
}

function cleanGroups(raw: any): Group[] {
  const out: Group[] = [];
  if (Array.isArray(raw.groups)) {
    for (const g of raw.groups) {
      if (!g || typeof g !== "object") continue;
      out.push({
        id: typeof g.id === "string" && g.id ? g.id : crypto.randomUUID(),
        title: typeof g.title === "string" ? g.title : "",
        tiles: cleanTiles(g.tiles),
        master: Array.isArray(g.master) ? g.master.filter((x: any) => typeof x === "string") : [],
      });
    }
  } else if (Array.isArray(raw.tiles)) {
    // eski format: tek düz liste
    out.push({ id: crypto.randomUUID(), title: "", tiles: cleanTiles(raw.tiles), master: [] });
  }
  return out;
}

function cleanAction(a: any): Action | null {
  if (!a || typeof a.type !== "string") return null;
  if (a.type === "popup" || a.type === "palette") return { type: a.type };
  if (typeof a.entity_id !== "string") return null;
  switch (a.type) {
    case "toggle":
    case "on":
    case "off":
    case "run":
      return { type: a.type, entity_id: a.entity_id };
    case "adjust":
      return Number.isFinite(a.delta)
        ? { type: "adjust", entity_id: a.entity_id, delta: a.delta }
        : null;
    case "set":
      return Number.isFinite(a.value)
        ? { type: "set", entity_id: a.entity_id, value: a.value }
        : null;
  }
  return null;
}

function cleanShortcuts(list: any): Shortcut[] {
  if (!Array.isArray(list)) return [];
  const out: Shortcut[] = [];
  for (const x of list) {
    const action = cleanAction(x?.action);
    if (!action || typeof x.keys !== "string") continue;
    out.push({
      id: typeof x.id === "string" && x.id ? x.id : crypto.randomUUID(),
      keys: x.keys,
      action,
    });
  }
  return out;
}

function parse(text: string): { s: Settings; g: Group[]; sg: Group[]; sc: Shortcut[] } {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object") throw new Error("Geçersiz yedek");
  const c = raw.connection ?? {};
  const a = raw.appearance ?? {};
  const s: Settings = {
    connection: {
      primaryUrl: String(c.primaryUrl ?? ""),
      fallbackUrl: String(c.fallbackUrl ?? ""),
    },
    appearance: {
      theme: ["dark", "light", "system"].includes(a.theme) ? a.theme : defaults.appearance.theme,
      accent: /^#[0-9a-f]{6}$/i.test(a.accent) ? a.accent : defaults.appearance.accent,
    },
    palette: { sensors: raw.palette?.sensors === true },
  };
  return {
    s,
    g: cleanGroups(raw),
    sg: cleanGroups({ groups: raw.sensors }),
    sc: cleanShortcuts(raw.shortcuts),
  };
}

// ---------- kaydetme (gecikmeli) ----------

let ready = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function snapshot() {
  return {
    version: VERSION,
    ...get(settings),
    groups: get(groups),
    sensors: get(sensorGroups),
    shortcuts: get(shortcuts),
  };
}

async function flush() {
  try {
    await invoke("save_config", { json: JSON.stringify(snapshot(), null, 2) });
  } catch (e) {
    console.error("Ayarlar kaydedilemedi", e);
  }
}

function scheduleSave() {
  if (!ready) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

groups.subscribe(scheduleSave);
sensorGroups.subscribe(scheduleSave);
shortcuts.subscribe(scheduleSave);
settings.subscribe(scheduleSave);

// ---------- ilk yükleme ----------

async function migrateLegacy() {
  try {
    const url = localStorage.getItem("ha_url") ?? "";
    const token = localStorage.getItem("ha_token") ?? "";
    const old = localStorage.getItem("ha_desk_config");
    const oldTiles = old ? cleanTiles(JSON.parse(old).tiles) : [];
    if (!url && !token && oldTiles.length === 0) return;

    settings.update((s) => ({ ...s, connection: { ...s.connection, primaryUrl: url } }));
    groups.set([{ id: crypto.randomUUID(), title: "", tiles: oldTiles, master: [] }]);
    if (token) await invoke("set_token", { token });
    await flush();

    localStorage.removeItem("ha_url");
    localStorage.removeItem("ha_token");
    localStorage.removeItem("ha_desk_config");
  } catch (e) {
    console.error("Eski ayarlar taşınamadı", e);
  }
}

export async function initConfig() {
  const text = (await invoke("load_config")) as string | null;
  if (text) {
    try {
      const { s, g, sg, sc } = parse(text);
      settings.set(s);
      groups.set(g);
      sensorGroups.set(sg);
      shortcuts.set(sc);
    } catch (e) {
      console.error("config.json okunamadı", e);
      try { localStorage.setItem("ha_desk_corrupt_backup", text); } catch {}
    }
  } else {
    await migrateLegacy();
  }
  if (get(groups).length === 0) groups.set([newGroup()]);
  if (get(sensorGroups).length === 0) sensorGroups.set([newGroup()]);
  ready = true;
}

// ---------- dışa / içe aktarma (token dahil değil) ----------

export function exportJson(): string {
  return JSON.stringify(snapshot(), null, 2);
}

export function importJson(text: string) {
  const { s, g, sg, sc } = parse(text);
  settings.set(s);
  groups.set(g.length ? g : [newGroup()]);
  sensorGroups.set(sg.length ? sg : [newGroup()]);
  shortcuts.set(sc);
}

// ---------- kutucuk ve grup işlemleri (kutucuklar ve sensörler için ortak) ----------

function makeOps(store: Writable<Group[]>) {
  return {
    addTile: (entity_id: string, groupId?: string) =>
      store.update((gs) => {
        if (gs.some((g) => g.tiles.some((t) => t.entity_id === entity_id))) return gs;
        const target = gs.find((g) => g.id === groupId) ?? gs[0];
        if (!target) return gs;
        return gs.map((g) =>
          g === target
            ? { ...g, tiles: [...g.tiles, { id: crypto.randomUUID(), entity_id, span: 1 as const }] }
            : g
        );
      }),

    removeTile: (id: string) =>
      store.update((gs) =>
        gs.map((g) => ({
          ...g,
          tiles: g.tiles.filter((t) => t.id !== id),
          master: g.master.filter((m) => m !== id),
        }))
      ),

    // Kutucuklar sürüklenerek başka gruba geçince eski grubun toplu anahtar listesi de temizlenir
    setGroupTiles: (groupId: string, tiles: Tile[]) =>
      store.update((gs) =>
        gs.map((g) =>
          g.id === groupId
            ? { ...g, tiles, master: g.master.filter((m) => tiles.some((t) => t.id === m)) }
            : g
        )
      ),

    setGroups: (next: Group[]) => store.set(next),

    addGroup: () => store.update((gs) => [...gs, newGroup()]),

    renameGroup: (id: string, title: string) =>
      store.update((gs) => gs.map((g) => (g.id === id ? { ...g, title: title.trim() } : g))),

    // Silinen grubun kutucukları ilk kalan gruba taşınır
    removeGroup: (id: string) =>
      store.update((gs) => {
        if (gs.length <= 1) return gs;
        const gone = gs.find((g) => g.id === id);
        const rest = gs.filter((g) => g.id !== id);
        if (gone && gone.tiles.length) {
          rest[0] = { ...rest[0], tiles: [...rest[0].tiles, ...gone.tiles] };
        }
        return rest;
      }),

    // Grubun toplu anahtarına kutucuk ekle/çıkar
    toggleMaster: (groupId: string, tileId: string) =>
      store.update((gs) =>
        gs.map((g) =>
          g.id === groupId
            ? {
                ...g,
                master: g.master.includes(tileId)
                  ? g.master.filter((m) => m !== tileId)
                  : [...g.master, tileId],
              }
            : g
        )
      ),

    setTileSpan: (id: string, span: 1 | 2) =>
      store.update((gs) =>
        gs.map((g) => ({ ...g, tiles: g.tiles.map((t) => (t.id === id ? { ...t, span } : t)) }))
      ),
  };
}

export type BoardOps = ReturnType<typeof makeOps>;
export const tileOps = makeOps(groups);
export const sensorOps = makeOps(sensorGroups);

// HA'da entity_id değişince kutucuklar, sensörler ve kısayollar otomatik yeni id'ye geçer
const renameIn = (store: Writable<Group[]>, oldId: string, newId: string) =>
  store.update((gs) =>
    gs.map((g) => ({
      ...g,
      tiles: g.tiles.map((t) => (t.entity_id === oldId ? { ...t, entity_id: newId } : t)),
    }))
  );

ha.onRename = (oldId, newId) => {
  renameIn(groups, oldId, newId);
  renameIn(sensorGroups, oldId, newId);
  shortcuts.update((l) =>
    l.map((s) =>
      "entity_id" in s.action && s.action.entity_id === oldId
        ? { ...s, action: { ...s.action, entity_id: newId } as Action }
        : s
    )
  );
};

// ---------- görünüm ----------

export function applyAppearance(a: Settings["appearance"]) {
  if (typeof document === "undefined") return;
  const dark =
    a.theme === "dark" ||
    (a.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.setProperty("--accent", a.accent);
}

settings.subscribe((s) => applyAppearance(s.appearance));

if (typeof window !== "undefined") {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => applyAppearance(get(settings).appearance));
}
