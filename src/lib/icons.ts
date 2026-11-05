// Varlık türüne göre simge adı (Icon.svelte'deki adlar)
const BY_DOMAIN: Record<string, string> = {
  light: "bulb",
  switch: "plug",
  input_boolean: "toggle",
  fan: "fan",
  cover: "blinds",
  lock: "lock",
  climate: "thermo",
  media_player: "speaker",
  scene: "scene",
  script: "script",
  automation: "auto",
  number: "sliders",
  input_number: "sliders",
  select: "list",
  input_select: "list",
  button: "button",
  input_button: "button",
  sensor: "pulse",
  binary_sensor: "dot",
};

export const iconOf = (entityId: string): string => BY_DOMAIN[entityId.split(".")[0]] ?? "pulse";
