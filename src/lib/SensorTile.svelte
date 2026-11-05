<script lang="ts">
  import { onDestroy } from "svelte";
  import type { HaEntity } from "$lib/ha";
  import { fetchHistory } from "$lib/history";
  import { binInfo } from "$lib/tileKind";
  import { t, tn } from "$lib/i18n";
  import type { Point } from "$lib/history";

  export let entityId: string;
  export let entity: HaEntity | undefined;
  export let loaded = false;
  export let editing = false;
  export let span: 1 | 2 = 1;
  export let onRemove: () => void = () => {};
  export let onSpan: () => void = () => {};

  $: isBinary = entityId.startsWith("binary_sensor.");
  $: state = entity?.state ?? "";
  $: dead = !entity || state === "unavailable" || state === "unknown";
  $: num = Number(state);
  $: isNumeric = !isBinary && state !== "" && Number.isFinite(num);
  $: unit = entity?.attributes.unit_of_measurement ?? "";
  $: name = entity?.attributes.friendly_name ?? entityId;
  $: bin = binInfo(entity?.attributes.device_class, $t);
  $: active = isBinary && state === "on";
  $: isAlert = active && bin[2];
  $: big = dead ? "—" : isBinary ? (active ? bin[0] : bin[1]) : isNumeric ? fmt(num) : state;

  function fmt(v: number): string {
    const p = Number(entity?.attributes.suggested_display_precision);
    if (Number.isInteger(p) && p >= 0) return v.toFixed(p);
    return String(Math.round(v * 100) / 100);
  }

  // ---- 24 saatlik mini grafik (yalnızca tam genişlikteki sayısal sensörlerde) ----

  const W = 200;
  const H = 44;
  let pts: Point[] = [];
  let histMsg = "";
  let timer: ReturnType<typeof setInterval> | null = null;

  function downsample(p: Point[], n: number): Point[] {
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

  async function load() {
    try {
      pts = downsample(await fetchHistory(entityId, 24), 48);
      histMsg = pts.length < 2 ? tn("sensor.noChart") : "";
    } catch (e) {
      pts = [];
      histMsg = tn("sensor.chartFail", { err: String(e) });
    }
  }

  function start() {
    if (timer) return;
    load();
    timer = setInterval(load, 5 * 60 * 1000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function build(p: Point[]) {
    if (p.length < 2) return { line: "", area: "", lo: 0, hi: 0 };
    const lo = Math.min(...p.map((x) => x.v));
    const hi = Math.max(...p.map((x) => x.v));
    const flat = hi === lo;
    const t0 = p[0].t;
    const dt = p[p.length - 1].t - t0 || 1;
    const xy = p.map((x) => {
      const px = ((x.t - t0) / dt) * W;
      const py = flat ? H / 2 : H - 4 - ((x.v - lo) / (hi - lo)) * (H - 8);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    });
    const line = "M" + xy.join(" L");
    return { line, area: `${line} L${W},${H} L0,${H} Z`, lo, hi };
  }

  $: wantChart = span === 2 && isNumeric && !dead;
  $: if (wantChart) start();
  else stop();
  $: chart = build(pts);

  onDestroy(stop);
</script>

<div class="stile" class:active class:alert={isAlert} class:dead class:missing={loaded && !entity}>
  {#if editing}
    <div class="edit">
      <button on:click|stopPropagation={onSpan} title={span === 2 ? $t("tile.halve") : $t("tile.widenChart")}>
        {span === 2 ? "½" : "↔"}
      </button>
      <button class="del" on:click|stopPropagation={onRemove} title={$t("common.remove")}>✕</button>
    </div>
  {/if}

  <span class="name">{name}</span>

  {#if !entity}
    <span class="sub">{loaded ? $t("common.notFound") : $t("common.loadingLc")}</span>
  {:else if isBinary}
    <div class="row">
      <span class="dot" class:on={active} class:alert={isAlert}></span>
      <span class="big">{big}</span>
    </div>
  {:else}
    <div class="row">
      <span class="big">{big}</span>
      {#if isNumeric && unit}<span class="unit">{unit}</span>{/if}
    </div>
  {/if}

  {#if wantChart}
    {#if chart.line}
      <svg class="chart" viewBox="0 0 {W} {H}" preserveAspectRatio="none">
        <path class="area" d={chart.area} />
        <path class="line" d={chart.line} />
      </svg>
      <div class="mm">
        <span>↓ {fmt(chart.lo)}{unit ? " " + unit : ""}</span>
        <span>↑ {fmt(chart.hi)}{unit ? " " + unit : ""}</span>
      </div>
    {:else if histMsg}
      <span class="sub">{histMsg}</span>
    {/if}
  {/if}
</div>

<style>
  .stile {
    position: relative;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    min-height: 64px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    transition: background 0.2s, border-color 0.2s;
  }
  .stile.active { border-color: var(--accent); background: var(--card-on); }
  .stile.alert {
    border-color: #e5484d;
    background: color-mix(in srgb, #e5484d 16%, var(--card));
  }
  .stile.dead { opacity: 0.6; }
  .stile.missing { border-style: dashed; opacity: 0.7; }

  .name {
    font-size: 12px;
    opacity: 0.75;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub { font-size: 11px; opacity: 0.65; }
  .row { display: flex; align-items: baseline; gap: 4px; min-width: 0; }
  .big {
    font-size: 22px;
    font-weight: 700;
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .unit { font-size: 12px; font-weight: 500; opacity: 0.7; }

  .dot {
    align-self: center;
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #888;
  }
  .dot.on { background: var(--accent); }
  .dot.alert { background: #e5484d; }

  .chart { width: 100%; height: 44px; margin-top: 4px; }
  .chart .area { fill: color-mix(in srgb, var(--accent) 22%, transparent); stroke: none; }
  .chart .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .mm { display: flex; justify-content: space-between; font-size: 10px; opacity: 0.6; }

  .edit {
    position: absolute;
    top: -8px;
    right: 6px;
    display: flex;
    gap: 3px;
    z-index: 2;
  }
  .edit button {
    padding: 1px 7px;
    font-size: 12px;
    background: #444;
    color: #fff;
    border: 1px solid #666;
    border-radius: 6px;
    cursor: pointer;
  }
  .edit .del { background: #7a2b2b; }
</style>
