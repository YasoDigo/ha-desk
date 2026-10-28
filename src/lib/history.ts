import { ha } from "./ha";

export type Point = { t: number; v: number };
export type StatePoint = { t: number; s: string };

// HA geçmişi: son N saatteki durum değişiklikleri (zaman + durum metni)
async function rawStates(entityId: string, hours: number): Promise<StatePoint[]> {
  const start = new Date(Date.now() - hours * 3600_000).toISOString();
  const res = await ha.call<Record<string, any[]>>({
    type: "history/history_during_period",
    start_time: start,
    entity_ids: [entityId],
    minimal_response: true,
    no_attributes: true,
    significant_changes_only: false,
  });

  const out: StatePoint[] = [];
  for (const p of res?.[entityId] ?? []) {
    const s = String(p.s ?? p.state ?? "");
    const raw = p.lu ?? p.lc ?? p.last_updated ?? p.last_changed;
    const t = typeof raw === "number" ? raw * 1000 : Date.parse(raw);
    if (s !== "" && Number.isFinite(t)) out.push({ t, s });
  }
  return out;
}

export const fetchStates = rawStates;

// Sayısal sensörler için: sadece sayıya çevrilebilen noktalar
export async function fetchHistory(entityId: string, hours = 24): Promise<Point[]> {
  const now = Date.now();
  const pts: Point[] = [];
  for (const p of await rawStates(entityId, hours)) {
    const v = Number(p.s);
    if (Number.isFinite(v)) pts.push({ t: p.t, v });
  }

  // HA yalnızca değişiklikleri kaydeder; sabit kalan sensörde tek nokta gelir.
  // Son değeri şimdiye kadar uzatıp düz çizgi elde ediyoruz.
  if (pts.length > 0 && now - pts[pts.length - 1].t > 1000) {
    pts.push({ t: now, v: pts[pts.length - 1].v });
  }
  return pts;
}

// Çok sayıda noktayı n kovaya indirip her kovanın ortalamasını alır
export function downsample(p: Point[], n: number): Point[] {
  if (p.length <= n) return p;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * p.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * p.length) / n));
    const chunk = p.slice(a, b);
    out.push({
      t: chunk.reduce((s, x) => s + x.t, 0) / chunk.length,
      v: chunk.reduce((s, x) => s + x.v, 0) / chunk.length,
    });
  }
  return out;
}
