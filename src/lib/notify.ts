import { get } from "svelte/store";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { ha, entities, lastError } from "./ha";
import { tn } from "./i18n/core";
import type { HaEntity } from "./ha";
import { rules, settings } from "./config";
import type { Rule, RuleWhen } from "./config";

type Snap = Pick<HaEntity, "state" | "attributes">;

const DEAD = new Set(["unavailable", "unknown"]);
const MIN_GAP_MS = 5000; // aynı kural en sık bu aralıkla bildirim gönderir (bildirim yağmasın)

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const lastFired = new Map<string, number>();

// ---------- kural işlemleri (ayarlar ekranı kullanır) ----------

export const newRule = (): Rule => ({
  id: crypto.randomUUID(),
  name: tn("rule.new"),
  enabled: true,
  entity_id: "",
  when: { type: "state", to: "on" },
  forSec: 0,
  title: "{name}",
  body: "{name}: {state}",
});

// Yeni kural ekler ve id'sini döner (ayarlar ekranı onu düzenleme moduna açar)
export function addRule(): string {
  const r = newRule();
  rules.update((l) => [...l, r]);
  return r.id;
}
export const removeRule = (id: string) => rules.update((l) => l.filter((r) => r.id !== id));
export const patchRule = (id: string, patch: Partial<Rule>) =>
  rules.update((l) => l.map((r) => (r.id === id ? { ...r, ...patch } : r)));

export function setWhenType(id: string, type: RuleWhen["type"]) {
  const stateless = type === "change" || type === "triggered";
  const when: RuleWhen =
    type === "state"
      ? { type: "state", to: "on" }
      : type === "change" || type === "triggered"
        ? { type }
        : { type, value: 0 };
  patchRule(id, stateless ? { when, forSec: 0 } : { when });
}

// ---------- bildirim gönderme ----------

export async function notify(title: string, body: string) {
  try {
    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === "granted";
    // Windows'ta sound verilmezse bildirim sessiz gelir; "Default" sistem bildirim sesini çalar
    if (ok) sendNotification({ title: title || "HA Desk", body, sound: "Default" });
  } catch (e) {
    console.error("Bildirim gönderilemedi", e);
    lastError.set(tn("notify.sendFail", { err: String(e) }));
  }
}

// {name} {state} {old} {unit} yer tutucularını doldurur
function render(t: string, r: Rule, cur: Snap, old: Snap | null): string {
  const vars: Record<string, string> = {
    name: String(cur.attributes.friendly_name ?? r.entity_id),
    state: cur.state,
    old: old?.state ?? "",
    unit: String(cur.attributes.unit_of_measurement ?? ""),
  };
  return t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m)).trim();
}

function fire(r: Rule, cur: Snap, old: Snap | null) {
  const now = Date.now();
  if (now - (lastFired.get(r.id) ?? 0) < MIN_GAP_MS) return;
  lastFired.set(r.id, now);
  notify(render(r.title, r, cur, old), render(r.body, r, cur, old));
}

// Ayarlardaki "Dene" düğmesi: kuralı şu anki durumla bir kez gönderir
export function testRule(r: Rule) {
  const cur = get(entities)[r.entity_id];
  if (!cur) {
    notify(
      tn("notify.testTitle"),
      tn("notify.notFound", { id: r.entity_id || tn("notify.noEntity") })
    );
    return;
  }
  notify(render(r.title, r, cur, cur), render(r.body, r, cur, cur));
}

// ---------- kural değerlendirme ----------

// Koşul bu durumda sağlanıyor mu? ("change" kuralı durumsuz olduğu için burada hep false)
function holds(r: Rule, st: Snap | null): boolean {
  if (!st) return false;
  const w = r.when;
  switch (w.type) {
    case "state":
      return st.state === w.to;
    case "above":
    case "below": {
      if (st.state.trim() === "") return false;
      const v = Number(st.state);
      if (!Number.isFinite(v)) return false;
      return w.type === "above" ? v > w.value : v < w.value;
    }
    default:
      return false;
  }
}

function clearTimer(id: string) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
}

function handle(id: string, oldS: Snap | null, newS: Snap | null) {
  if (!get(settings).notifications.enabled) return;
  for (const r of get(rules)) {
    if (!r.enabled || r.entity_id !== id || !newS) continue;

    if (r.when.type === "triggered") {
      // Otomasyon çalışınca durumu değişmez; last_triggered özelliği değişir
      const now = newS.attributes.last_triggered;
      if (!oldS || !now || now === oldS.attributes.last_triggered) continue;
      fire(r, newS, oldS);
      continue;
    }

    if (r.when.type === "change") {
      if (!oldS || newS.state === oldS.state) continue; // sadece özellik değişimi
      if (DEAD.has(newS.state) || DEAD.has(oldS.state)) continue;
      fire(r, newS, oldS);
      continue;
    }

    const was = holds(r, oldS);
    const now = holds(r, newS);
    if (now && !was) {
      // HA yeniden başlayınca "kullanılamıyor" -> eski değer geçişi bildirim sayılmasın
      if (oldS && DEAD.has(oldS.state) && !DEAD.has(newS.state)) continue;
      if (r.forSec > 0) {
        clearTimer(r.id);
        timers.set(
          r.id,
          setTimeout(() => {
            timers.delete(r.id);
            const cur = get(entities)[id];
            const latest = get(rules).find((x) => x.id === r.id);
            if (!cur || !latest || !latest.enabled || latest.entity_id !== id) return;
            if (!get(settings).notifications.enabled || !holds(latest, cur)) return;
            fire(latest, cur, oldS);
          }, r.forSec * 1000)
        );
      } else {
        fire(r, newS, oldS);
      }
    } else if (!now && was) {
      clearTimer(r.id); // koşul bozuldu, bekleyen "şu kadar sürerse" sayacı iptal
    }
  }
}

// Sadece ana pencere çağırır (komut paletinin kendi bağlantısı bildirim göndermesin)
export function startNotifications() {
  ha.onChange = handle;
}
