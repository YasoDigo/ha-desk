<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { HaEntity } from "$lib/ha";
  import { fetchHistory, downsample } from "$lib/history";
  import type { Point } from "$lib/history";

  export let entityId: string;
  export let entity: HaEntity | undefined;
  export let onClose: () => void = () => {};

  const RANGES = [
    { h: 6, label: "6 sa" },
    { h: 24, label: "24 sa" },
    { h: 168, label: "7 gün" },
  ];
  const W = 360;
  const H = 140;
  const PAD = 12;

  let hours = 24;
  let pts: Point[] = [];
  let loading = true;
  let msg = "";
  let hover: number | null = null; // 0..1, grafik üzerinde yatay konum
  let timer: ReturnType<typeof setInterval> | null = null;

  $: name = entity?.attributes.friendly_name ?? entityId;
  $: unit = entity?.attributes.unit_of_measurement ?? "";
  $: u = unit ? " " + unit : "";
  $: num = Number(entity?.state);
  $: current =
    entity && entity.state !== "" && Number.isFinite(num) ? fmt(num) : entity?.state ?? "—";

  function fmt(v: number): string {
    const p = Number(entity?.attributes.suggested_display_precision);
    if (Number.isInteger(p) && p >= 0) return v.toFixed(p);
    return String(Math.round(v * 100) / 100);
  }

  const fmtT = (t: number) =>
    new Date(t).toLocaleString(
      "tr-TR",
      hours > 24
        ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
        : { hour: "2-digit", minute: "2-digit" }
    );

  async function load() {
    try {
      const raw = await fetchHistory(entityId, hours);
      pts = downsample(raw, 160);
      msg = pts.length < 2 ? "Bu aralıkta yeterli veri yok" : "";
    } catch (e) {
      pts = [];
      msg = "Geçmiş yüklenemedi: " + String(e);
    }
    loading = false;
  }

  function setRange(h: number) {
    hours = h;
    pts = [];
    hover = null;
    loading = true;
    load();
  }

  onMount(() => {
    load();
    timer = setInterval(load, 60_000);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  function build(p: Point[]) {
    if (p.length < 2) return null;
    const lo = Math.min(...p.map((x) => x.v));
    const hi = Math.max(...p.map((x) => x.v));
    const flat = hi === lo;
    const span = hi - lo || 1;
    const t0 = p[0].t;
    const t1 = p[p.length - 1].t;
    const dt = t1 - t0 || 1;
    const X = (t: number) => ((t - t0) / dt) * W;
    const Y = (v: number) => (flat ? H / 2 : PAD + (1 - (v - lo) / span) * (H - 2 * PAD));
    const line = "M" + p.map((x) => `${X(x.t).toFixed(1)},${Y(x.v).toFixed(1)}`).join(" L");
    const avg = p.reduce((s, x) => s + x.v, 0) / p.length;
    return { line, area: `${line} L${W},${H} L0,${H} Z`, lo, hi, avg, t0, t1, dt, X, Y };
  }

  function nearest(c: NonNullable<ReturnType<typeof build>>, f: number): Point {
    const target = c.t0 + f * c.dt;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.t - target) < Math.abs(best.t - target)) best = p;
    return best;
  }

  function onMove(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hover = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }

  $: chart = build(pts);
  $: hp = chart && hover !== null ? nearest(chart, hover) : null;
  $: hx = chart && hp ? (chart.X(hp.t) / W) * 100 : 0;
  $: hy = chart && hp ? (chart.Y(hp.v) / H) * 100 : 0;
</script>

<div class="sdetail">
  <div class="top">
    <div class="title">
      <span class="name">{name}</span>
      <span class="cur">{current}<small>{u}</small></span>
    </div>
    <button class="close" on:click={onClose} title="Kapat">✕</button>
  </div>

  <div class="rng">
    {#each RANGES as r}
      <button class:sel={hours === r.h} on:click={() => setRange(r.h)}>{r.label}</button>
    {/each}
  </div>

  {#if loading}
    <p class="hint">Yükleniyor…</p>
  {:else if msg || !chart}
    <p class="hint">{msg || "Veri yok"}</p>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="plot" on:mousemove={onMove} on:mouseleave={() => (hover = null)}>
      <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none">
        <line class="grid" x1="0" y1={PAD} x2={W} y2={PAD} />
        <line class="grid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
        <line class="grid" x1="0" y1={H - PAD} x2={W} y2={H - PAD} />
        <path class="area" d={chart.area} />
        <path class="line" d={chart.line} />
      </svg>
      <span class="ylab top">{fmt(chart.hi)}</span>
      <span class="ylab bot">{fmt(chart.lo)}</span>

      {#if hp}
        <div class="vline" style="left: {hx}%"></div>
        <div class="mark" style="left: {hx}%; top: {hy}%"></div>
        <div class="tip" style="left: {Math.min(78, Math.max(22, hx))}%">
          {fmt(hp.v)}{u} · {fmtT(hp.t)}
        </div>
      {/if}
    </div>

    <div class="xlab"><span>{fmtT(chart.t0)}</span><span>{fmtT(chart.t1)}</span></div>

    <div class="stats">
      <div><span>En düşük</span><b>{fmt(chart.lo)}{u}</b></div>
      <div><span>Ortalama</span><b>{fmt(chart.avg)}{u}</b></div>
      <div><span>En yüksek</span><b>{fmt(chart.hi)}{u}</b></div>
    </div>
  {/if}
</div>

<style>
  .sdetail {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    background: var(--card);
    border: 1px solid var(--accent);
    border-radius: 12px;
  }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .name { font-size: 13px; opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cur { font-size: 30px; font-weight: 700; line-height: 1.1; }
  .cur small { font-size: 14px; font-weight: 500; opacity: 0.7; }
  .close {
    padding: 3px 9px;
    font-size: 14px;
    border-radius: 8px;
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: inherit;
    cursor: pointer;
  }
  .close:hover { background: var(--hover); }

  .rng { display: flex; gap: 2px; padding: 2px; background: var(--bg); border-radius: 9px; align-self: flex-start; }
  .rng button {
    border: none;
    background: transparent;
    color: inherit;
    padding: 4px 10px;
    font-size: 12px;
    border-radius: 7px;
    cursor: pointer;
  }
  .rng button.sel { background: var(--accent); color: #1a1a1a; font-weight: 600; }

  .hint { opacity: 0.65; font-size: 13px; margin: 0; }

  .plot { position: relative; height: 140px; cursor: crosshair; }
  .plot svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .grid { stroke: var(--border); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .area { fill: color-mix(in srgb, var(--accent) 22%, transparent); stroke: none; }
  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .ylab { position: absolute; left: 2px; font-size: 10px; opacity: 0.6; pointer-events: none; }
  .ylab.top { top: 0; }
  .ylab.bot { bottom: 0; }

  .vline {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--text);
    opacity: 0.35;
    pointer-events: none;
  }
  .mark {
    position: absolute;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--card);
    pointer-events: none;
  }
  .tip {
    position: absolute;
    top: -6px;
    transform: translate(-50%, -100%);
    padding: 3px 8px;
    font-size: 11px;
    white-space: nowrap;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    pointer-events: none;
  }

  .xlab { display: flex; justify-content: space-between; font-size: 10px; opacity: 0.6; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .stats div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    background: var(--bg);
    border-radius: 8px;
  }
  .stats span { font-size: 10px; opacity: 0.65; }
  .stats b { font-size: 13px; font-variant-numeric: tabular-nums; }
</style>
