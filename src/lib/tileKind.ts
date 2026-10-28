import { ha } from "./ha";
import type { HaEntity } from "./ha";

export type Kind = "toggle" | "dimmer" | "button" | "select" | "number" | "sensor";

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
