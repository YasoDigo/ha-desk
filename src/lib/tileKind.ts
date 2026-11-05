import { ha } from "./ha";
import type { HaEntity } from "./ha";
import { hasKey } from "./i18n/core";
import type { TFn } from "./i18n/core";

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

// "<önek>.<değer>" sözlükte varsa çevirir, yoksa değeri olduğu gibi döner
function lookup(prefix: string, v: string, t: TFn): string {
  const k = `${prefix}.${v}`;
  return hasKey(k) ? t(k) : v;
}
export const hvacLabel = (mode: string, t: TFn) => lookup("hvac", mode, t);
export const stateText = (s: string, t: TFn) => lookup("state", s, t);

// binary_sensor: device_class -> [açıkken metin, kapalıyken metin, açıkken uyarı mı?]
const BIN_ALERT = new Set(["lock", "moisture", "smoke", "gas", "problem", "safety", "tamper", "battery"]);
export function binInfo(deviceClass: unknown, t: TFn): [string, string, boolean] {
  const c = typeof deviceClass === "string" ? deviceClass : "";
  const known = hasKey(`bin.${c}.on`);
  const k = known ? c : "default";
  return [lookup("bin", `${k}.on`, t), lookup("bin", `${k}.off`, t), known && BIN_ALERT.has(c)];
}

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
export function describe(e: HaEntity, t: TFn): string {
  const a = e.attributes;
  const s = e.state;
  if (s === "unavailable") return t("state.unavailable");
  switch (kindOf(e)) {
    case "cover": {
      const base = stateText(s, t);
      const p = a.current_position;
      return typeof p === "number" && s !== "closed" ? `${base} · %${Math.round(p)}` : base;
    }
    case "lock":
      return stateText(s, t);
    case "climate": {
      const act = a.hvac_action ? String(a.hvac_action) : "";
      const head = (act && hasKey(`hvacAct.${act}`) ? lookup("hvacAct", act, t) : "") || hvacLabel(s, t);
      const cur =
        typeof a.current_temperature === "number"
          ? t("climate.now", { t: num1(a.current_temperature) })
          : "";
      return head + cur;
    }
    case "media": {
      const title = a.media_title ? String(a.media_title) : "";
      const artist = a.media_artist ? String(a.media_artist) : "";
      const track = title ? (artist ? `${artist} – ${title}` : title) : "";
      if (s === "playing" && track) return track;
      if (s === "paused" && track) return t("media.pausedTrack", { track });
      return stateText(s, t);
    }
    default:
      return s;
  }
}
