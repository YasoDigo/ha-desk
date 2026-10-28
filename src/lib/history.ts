import { ha } from "./ha";

export type Point = { t: number; v: number };

// Sensörün son N saatlik sayısal geçmişi (HA WebSocket geçmiş API'si)
export async function fetchHistory(entityId: string, hours = 24): Promise<Point[]> {
  const now = Date.now();
  const start = new Date(now - hours * 3600_000).toISOString();
  const res = await ha.call<Record<string, any[]>>({
    type: "history/history_during_period",
    start_time: start,
    entity_ids: [entityId],
    minimal_response: true,
    no_attributes: true,
    significant_changes_only: false,
  });

  const list = res?.[entityId] ?? [];
  const pts: Point[] = [];
  for (const p of list) {
    const v = Number(p.s ?? p.state);
    const raw = p.lu ?? p.lc ?? p.last_updated ?? p.last_changed;
    const t = typeof raw === "number" ? raw * 1000 : Date.parse(raw);
    if (Number.isFinite(v) && Number.isFinite(t)) pts.push({ t, v });
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
