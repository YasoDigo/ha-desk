import { ha } from "./ha";
import type { HaEntity } from "./ha";

export type Kind =
  | "toggle"
  | "dimmer"
  | "button"
  | "select"
  | "number"
  | "sensor"
  | "cover"
  | "lock"
  | "climate"
  | "media";

// Tek başına kendi kontrol düğmeleri olan türler (kutucuğa tıklayınca bir şey olmaz)
export const EXTRA_KINDS: Kind[] = ["cover", "lock", "climate", "media"];

export const domainOf = (id: string) => id.split(".")[0];

export function kindOf(e: HaEntity): Kind {
  switch (domainOf(e.entity_id)) {
    case "light": {
      const modes: string[] = e.attributes.supported_color_modes ?? [];
      return modes.some((m) => m !== "onoff") ? "dimmer" : "toggle";
    }
    case "fan": {
      const speed = ((e.attributes.supported_features ?? 0) & 1) !== 0;
      return speed || "percentage" in e.attributes ? "dimmer" : "toggle";
    }
    case "switch":
    case "input_boolean":
    case "automation":
      return "toggle";
    case "scene":
    case "script":
    case "button":
    case "input_button":
      return "button";
    case "select":
    case "input_select":
      return "select";
    case "number":
    case "input_number":
      return "number";
    case "cover":
      return "cover";
    case "lock":
      return "lock";
    case "climate":
      return "climate";
    case "media_player":
      return "media";
    default:
      return "sensor";
  }
}

// light: parlaklık (0-255 -> %), fan: yüzde hız
export function pctOf(e: HaEntity): number {
  if (e.state !== "on") return 0;
  if (domainOf(e.entity_id) === "fan") return Math.round(e.attributes.percentage ?? 0);
  const b = e.attributes.brightness;
  return b == null ? 100 : Math.round((b / 255) * 100);
}

export function setPct(e: HaEntity, pct: number) {
  const d = domainOf(e.entity_id);
  if (pct <= 0) return ha.callService(d, "turn_off", e.entity_id);
  return d === "fan"
    ? ha.callService("fan", "turn_on", e.entity_id, { percentage: pct })
    : ha.callService("light", "turn_on", e.entity_id, { brightness_pct: pct });
}

export function press(e: HaEntity) {
  const d = domainOf(e.entity_id);
  const svc =
    d === "scene" || d === "script" ? "turn_on" : d === "automation" ? "trigger" : "press";
  return ha.callService(d, svc, e.entity_id);
}

export function lightCaps(e: HaEntity) {
  const a = e.attributes;
  const modes: string[] = a.supported_color_modes ?? [];
  const mired = (m?: number) => (m ? Math.round(1e6 / m) : undefined);
  return {
    brightness: modes.some((m) => m !== "onoff"),
    colorTemp: modes.includes("color_temp"),
    color: modes.some((m) => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(m)),
    effects: Array.isArray(a.effect_list) ? (a.effect_list as string[]) : [],
    minK: Number(a.min_color_temp_kelvin ?? mired(a.max_mireds) ?? 2000),
    maxK: Number(a.max_color_temp_kelvin ?? mired(a.min_mireds) ?? 6500),
  };
}

export function hasDetail(e: HaEntity): boolean {
  if (domainOf(e.entity_id) !== "light") return false;
  const c = lightCaps(e);
  return c.colorTemp || c.color || c.effects.length > 0;
}

// ---------- perde, kilit, klima, medya oynatıcı ----------

export const HVAC_TR: Record<string, string> = {
  off: "Kapalı",
  heat: "Isıt",
  cool: "Soğut",
  auto: "Oto",
  heat_cool: "Isıt/Soğut",
  dry: "Nem al",
  fan_only: "Fan",
};

const STATE_TR: Record<string, string> = {
  open: "Açık",
  closed: "Kapalı",
  opening: "Açılıyor",
  closing: "Kapanıyor",
  locked: "Kilitli",
  unlocked: "Kilit açık",
  locking: "Kilitleniyor",
  unlocking: "Kilit açılıyor",
  jammed: "Sıkıştı",
  playing: "Çalıyor",
  paused: "Duraklatıldı",
  idle: "Boşta",
  standby: "Beklemede",
  buffering: "Yükleniyor",
  on: "Açık",
  off: "Kapalı",
};

const ACTION_TR: Record<string, string> = {
  heating: "Isıtıyor",
  cooling: "Soğutuyor",
  idle: "Beklemede",
  off: "Kapalı",
  drying: "Nem alıyor",
  fan: "Fan çalışıyor",
};

const num1 = (n: number) => String(Number(n.toFixed(1)));

// Kutucuğun "açık/aktif" görünmesi gereken durumu
export function activeOf(e: HaEntity): boolean {
  const s = e.state;
  switch (kindOf(e)) {
    case "cover":
      return s === "open" || s === "opening" || s === "closing";
    case "lock":
      return s === "unlocked" || s === "unlocking" || s === "open";
    case "climate":
      return s !== "off" && s !== "unavailable" && s !== "unknown";
    case "media":
      return ["playing", "paused", "buffering", "on"].includes(s);
    default:
      return s === "on";
  }
}

// Kutucuğun alt satırı (durum özeti)
export function describe(e: HaEntity): string {
  const a = e.attributes;
  const s = e.state;
  if (s === "unavailable") return "Kullanılamıyor";
  switch (kindOf(e)) {
    case "cover": {
      const base = STATE_TR[s] ?? s;
      const p = a.current_position;
      return typeof p === "number" && s !== "closed" ? `${base} · %${Math.round(p)}` : base;
    }
    case "lock":
      return STATE_TR[s] ?? s;
    case "climate": {
      const head = (a.hvac_action && ACTION_TR[a.hvac_action]) || HVAC_TR[s] || s;
      const cur =
        typeof a.current_temperature === "number" ? ` · şu an ${num1(a.current_temperature)}°` : "";
      return head + cur;
    }
    case "media": {
      const title = a.media_title ? String(a.media_title) : "";
      const artist = a.media_artist ? String(a.media_artist) : "";
      const track = title ? (artist ? `${artist} – ${title}` : title) : "";
      if (s === "playing" && track) return track;
      if (s === "paused" && track) return `Duraklatıldı · ${track}`;
      return STATE_TR[s] ?? s;
    }
    default:
      return s;
  }
}
