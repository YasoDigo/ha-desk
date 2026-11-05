<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { HaEntity } from "$lib/ha";
  import { fetchHistory, downsample } from "$lib/history";
  import { t, tn, locale } from "$lib/i18n";
  import { sensorLook } from "$lib/sensorLook";
  import type { Point } from "$lib/history";

  export let entityId: string;
  export let entity: HaEntity | undefined;
  export let onClose: () => void = () => {};

  const RANGES = [
    { h: 6, label: "range.6h" as const },
    { h: 24, label: "range.24h" as const },
    { h: 168, label: "range.7d" as const },
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
      locale(),
      hours > 24
        ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
        : { hour: "2-digit", minute: "2-digit" }
    );

  async function load() {
    try {
      const raw = await fetchHistory(entityId, hours);
      pts = downsample(raw, 160);
      msg = pts.length < 2 ? tn("sensor.noRange") : "";
    } catch (e) {
      pts = [];
      msg = tn("sensor.histFail", { err: String(e) });
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

<div class="sdetail" style="--sc: {sensorLook(entityId, entity).color}">
  <div class="top">
    <div class="title">
      <span class="name">{name}</span>
      <span class="cur">{current}<small>{u}</small></span>
    </div>
    <button class="close" on:click={onClose} title={$t("common.close")}>✕</button>
  </div>

  <div class="rng">
    {#each RANGES as r}
      <button class:sel={hours === r.h} on:click={() => setRange(r.h)}>{$t(r.label)}</button>
    {/each}
  </div>

  {#if loading}
    <p class="hint">{$t("common.loading")}</p>
  {:else if msg || !chart}
    <p class="hint">{msg || $t("common.noData")}</p>
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
      <div><span>{$t("sensor.min")}</span><b>{fmt(chart.lo)}{u}</b></div>
      <div><span>{$t("sensor.avg")}</span><b>{fmt(chart.avg)}{u}</b></div>
      <div><span>{$t("sensor.max")}</span><b>{fmt(chart.hi)}{u}</b></div>
    </div>
  {/if}
</div>

<style>
  .sdetail {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    background: var(--plate);
    border-radius: 22px;
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--sc, var(--accent)) 70%, transparent);
  }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .name { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .close { padding: 4px 10px; font-size: 14px; border-radius: 999px; }

  .rng { display: flex; gap: 2px; padding: 3px; background: var(--field); border-radius: 999px; align-self: flex-start; }
  .rng button { background: transparent; padding: 4px 12px; font-size: 12px; border-radius: 999px; }
  .rng button.sel { background: color-mix(in srgb, var(--accent) 26%, var(--field)); color: var(--accent-text); font-weight: 600; }

  .hint { color: var(--muted); font-size: 13px; margin: 0; }
  .xlab { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--muted); }
  .stats div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    background: var(--field);
    border-radius: 12px;
  }
  .stats span { font-size: 10.5px; color: var(--muted); }
  .stats b { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }

  .cur {
    font-family: var(--font-display);
    font-size: 40px;
    font-weight: 300;
    letter-spacing: -0.03em;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .cur small { font-size: 16px; color: var(--muted); letter-spacing: 0; margin-left: 2px; }

  .plot { position: relative; height: 150px; cursor: crosshair; }
  .plot svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .grid { stroke: var(--line); stroke-width: 1; stroke-dasharray: 2 4; vector-effect: non-scaling-stroke; }
  .area { fill: color-mix(in srgb, var(--sc, var(--accent)) 20%, transparent); stroke: none; }
  .line { fill: none; stroke: var(--sc, var(--accent)); stroke-width: 2; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  .ylab { position: absolute; left: 2px; font-size: 10px; color: var(--muted); pointer-events: none; }
  .ylab.top { top: 0; }
  .ylab.bot { bottom: 0; }
  .vline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--text); opacity: 0.3; pointer-events: none; }
  .mark {
    position: absolute;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    border-radius: 50%;
    background: var(--sc, var(--accent));
    border: 2px solid var(--plate);
    pointer-events: none;
  }
  .tip {
    position: absolute;
    top: -6px;
    transform: translate(-50%, -100%);
    padding: 3px 9px;
    font-size: 11px;
    white-space: nowrap;
    background: var(--raised);
    border-radius: 8px;
    pointer-events: none;
  }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
</style>
