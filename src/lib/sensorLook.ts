import type { HaEntity } from "$lib/ha";

// Sensör türüne göre ikon ve renk (kutucuğun başlığı renklenir)
type Look = { icon: string; color: string };

const WARM = "#ef8a5b";
const BLUE = "#5aa9e6";
const AMBER = "#e6b84a";
const GREEN = "#6cc08b";
const YELLOW = "#e8cf5a";
const VIOLET = "#9b8fd8";
const ROSE = "#c58bb0";
const TEAL = "#7fb3c8";
const RED = "#ef6b6b";
const ORANGE = "#e0906a";
const NEUTRAL = "#9aa0ab";
const INDIGO = "#8fa3e8";
const PURPLE = "#b28ce0";
const MINT = "#50c2a8";
const SAND = "#c4a484";
const CYAN = "#62c6e8";

// Bilgisayar / sistem sensörleri adından tanınır (HA'ya sistem izleme ile eklenenler).
// Ad önce küçültülüp Türkçe harfleri sadeleştirilir ("İşlemci" -> "islemci", "Hafıza" -> "hafiza").
const plain = (s: string) =>
  s.toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const SYS: [RegExp, Look][] = [
  [/gpu|ekran karti/, { icon: "cpu", color: PURPLE }],
  [/cpu|islemci|processor/, { icon: "cpu", color: INDIGO }],
  [/memory|\bram\b|bellek|hafiza|swap/, { icon: "ram", color: MINT }],
  [/disk|storage|depolama|\bssd\b|\bhdd\b|nvme/, { icon: "disk", color: SAND }],
  [/network|download|upload|indirme|yukleme|bandwidth|throughput|ping|latency|gecikme/, { icon: "net", color: CYAN }],
  [/uptime|calisma suresi|last boot|son acilis/, { icon: "clock", color: NEUTRAL }],
];

const DC_SYS: Record<string, Look> = {
  data_rate: { icon: "net", color: CYAN },
  data_size: { icon: "disk", color: SAND },
  duration: { icon: "clock", color: NEUTRAL },
};

const NUM: Record<string, Look> = {
  temperature: { icon: "thermo", color: WARM },
  humidity: { icon: "drop", color: BLUE },
  moisture: { icon: "drop", color: BLUE },
  power: { icon: "auto", color: AMBER },
  apparent_power: { icon: "auto", color: AMBER },
  energy: { icon: "auto", color: AMBER },
  current: { icon: "auto", color: AMBER },
  voltage: { icon: "auto", color: AMBER },
  battery: { icon: "battery", color: GREEN },
  illuminance: { icon: "sun", color: YELLOW },
  pressure: { icon: "gauge", color: VIOLET },
  atmospheric_pressure: { icon: "gauge", color: VIOLET },
  co2: { icon: "wind", color: ROSE },
  pm25: { icon: "wind", color: ROSE },
  pm10: { icon: "wind", color: ROSE },
  aqi: { icon: "wind", color: ROSE },
  volatile_organic_compounds: { icon: "wind", color: ROSE },
  signal_strength: { icon: "wave", color: TEAL },
};

const BIN: Record<string, Look> = {
  motion: { icon: "pulse", color: AMBER },
  occupancy: { icon: "pulse", color: AMBER },
  presence: { icon: "pulse", color: AMBER },
  door: { icon: "door", color: ORANGE },
  garage_door: { icon: "door", color: ORANGE },
  window: { icon: "door", color: ORANGE },
  opening: { icon: "door", color: ORANGE },
  moisture: { icon: "drop", color: BLUE },
  smoke: { icon: "dot", color: RED },
  gas: { icon: "dot", color: RED },
  carbon_monoxide: { icon: "dot", color: RED },
  problem: { icon: "dot", color: RED },
  safety: { icon: "dot", color: RED },
  tamper: { icon: "dot", color: RED },
};

const UNIT: Record<string, Look> = {
  "°C": NUM.temperature, "°F": NUM.temperature,
  W: NUM.power, kW: NUM.power, kWh: NUM.energy, Wh: NUM.energy, A: NUM.current, V: NUM.voltage,
  lx: NUM.illuminance, hPa: NUM.pressure, ppm: NUM.co2, dBm: NUM.signal_strength,
  "Mbit/s": { icon: "net", color: CYAN }, "MB/s": { icon: "net", color: CYAN }, "KiB/s": { icon: "net", color: CYAN },
  GB: { icon: "disk", color: SAND }, GiB: { icon: "disk", color: SAND }, TB: { icon: "disk", color: SAND }, MiB: { icon: "disk", color: SAND }, MB: { icon: "disk", color: SAND },
  ms: { icon: "net", color: CYAN },
};

export function sensorLook(entityId: string, e: HaEntity | undefined): Look {
  const dc = String(e?.attributes.device_class ?? "");
  if (entityId.startsWith("binary_sensor.")) return BIN[dc] ?? { icon: "dot", color: "var(--accent)" };
  if (NUM[dc]) return NUM[dc];
  // önce adına bak ("Hafıza" MiB cinsinden de olsa RAM'dir), sonra genel türüne
  const label = plain(`${entityId} ${String(e?.attributes.friendly_name ?? "")}`);
  for (const [re, look] of SYS) if (re.test(label)) return look;
  if (DC_SYS[dc]) return DC_SYS[dc];
  if (/linkquality|rssi/i.test(entityId)) return NUM.signal_strength;
  const u = String(e?.attributes.unit_of_measurement ?? "");
  return UNIT[u] ?? { icon: "pulse", color: NEUTRAL };
}
