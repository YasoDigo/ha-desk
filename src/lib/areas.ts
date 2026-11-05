import { derived, writable } from "svelte/store";
import { ha, status } from "./ha";
import { locale } from "./i18n/core";

// HA'daki oda (alan) bilgisi: varlık doğrudan bir odaya bağlıysa o oda,
// değilse bağlı olduğu cihazın odası. Kayıt listeleri yönetici yetkisi ister;
// yetki yoksa liste boş kalır ve oda özellikleri gizlenir.

export type Area = { id: string; name: string };

export const areas = writable<Area[]>([]);
export const entityArea = writable<Record<string, string>>({}); // entity_id -> area_id

// entity_id -> oda adı
export const areaNames = derived([areas, entityArea], ([$a, $e]) => {
  const names = new Map($a.map((a) => [a.id, a.name]));
  const out: Record<string, string> = {};
  for (const [id, aid] of Object.entries($e)) {
    const n = names.get(aid);
    if (n) out[id] = n;
  }
  return out;
});

async function load() {
  try {
    const [al, dl, el] = await Promise.all([
      ha.call<any[]>({ type: "config/area_registry/list" }),
      ha.call<any[]>({ type: "config/device_registry/list" }),
      ha.call<any[]>({ type: "config/entity_registry/list" }),
    ]);
    const deviceArea = new Map<string, string>();
    for (const d of dl) if (d?.area_id) deviceArea.set(d.id, d.area_id);
    const map: Record<string, string> = {};
    for (const e of el) {
      const a = e?.area_id ?? (e?.device_id ? deviceArea.get(e.device_id) : undefined);
      if (a) map[e.entity_id] = a;
    }
    areas.set(
      al
        .map((a) => ({ id: String(a.area_id), name: String(a.name) }))
        .sort((x, y) => x.name.localeCompare(y.name, locale()))
    );
    entityArea.set(map);
  } catch {
    areas.set([]);
    entityArea.set({});
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
const later = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(load, 1000);
};

// Bağlanınca yükle; kayıtlar değişirse (oda eklendi, cihaz taşındı) kısa gecikmeyle yenile
status.subscribe((s) => {
  if (s !== "connected") return;
  load();
  for (const ev of ["area_registry_updated", "device_registry_updated", "entity_registry_updated"]) {
    ha.subscribe({ type: "subscribe_events", event_type: ev }, later).catch(() => {});
  }
});
