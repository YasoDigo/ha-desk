<script lang="ts">
  import { onDestroy } from "svelte";
  import type { HaEntity } from "$lib/ha";
  import { fetchHistory } from "$lib/history";
  import { binInfo } from "$lib/tileKind";
  import Icon from "$lib/Icon.svelte";
  import { sensorLook } from "$lib/sensorLook";
  import { marquee } from "$lib/marquee";
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
  $: look = sensorLook(entityId, entity);
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

<div class="stile" style="--sc: {look.color}" class:active class:alert={isAlert} class:dead class:missing={loaded && !entity}>
  {#if editing}
    <div class="edit">
      <button on:click|stopPropagation={onSpan} title={span === 2 ? $t("tile.halve") : $t("tile.widenChart")}>
        <Icon name={span === 2 ? "shrink" : "expand"} size={13} />
      </button>
      <button class="del" on:click|stopPropagation={onRemove} title={$t("common.remove")}><Icon name="close" size={12} /></button>
    </div>
  {/if}

  <span class="name" title={name}><span class="ic"><Icon name={look.icon} size={15} /></span><span class="nm mq" use:marquee={name}><span class="mi">{name}</span></span></span>

  {#if !entity}
    <span class="sub">{loaded ? $t("common.notFound") : $t("common.loadingLc")}</span>
  {:else if isBinary}
    <div class="row">
      <span class="dot" class:on={active} class:alert={isAlert}></span>
      <span class="big txt">{big}</span>
    </div>
  {:else}
    <div class="row">
      <span class="big" class:txt={!isNumeric}>{big}</span>
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
    background: var(--plate);
    border-radius: var(--r-tile);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 7%, transparent);
    transition: background 0.2s var(--ease), box-shadow 0.2s var(--ease);
  }
  /* etkin ikili sensör: çerçeve vurgu rengiyle yanar, zemin dolmaz (dolu zemin sadece açık anahtarlara ait) */
  .stile.active { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--sc) 80%, transparent); }
  .stile.alert {
    box-shadow: inset 0 0 0 1.5px var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, var(--plate));
  }
  .stile.dead { opacity: 0.55; }
  .stile.missing { box-shadow: inset 0 0 0 1.5px var(--line); background: transparent; opacity: 0.75; }

  .name {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  .ic {
    display: grid;
    place-items: center;
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    color: var(--sc);
    background: color-mix(in srgb, var(--sc) 16%, transparent);
  }
  .nm { flex: 1; }
  .sub { font-size: 12px; color: var(--muted); }
  .row { display: flex; align-items: baseline; gap: 5px; min-width: 0; margin-top: auto; }
  .big {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 300;
    line-height: 1.1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .big.txt { font-size: 17px; font-weight: 600; letter-spacing: 0; }
  .unit { font-size: 13px; color: var(--muted); }

  .dot {
    align-self: center;
    flex: none;
    margin: 0 5px 0 4px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--line);
  }
  .dot.on { background: var(--sc); box-shadow: 0 0 0 4px color-mix(in srgb, var(--sc) 25%, transparent); }
  .dot.alert { background: var(--danger); box-shadow: 0 0 0 4px color-mix(in srgb, var(--danger) 25%, transparent); }

  .chart { width: 100%; height: 44px; margin-top: 4px; }
  .chart .area { fill: color-mix(in srgb, var(--sc) 20%, transparent); stroke: none; }
  .chart .line {
    fill: none;
    stroke: var(--sc);
    stroke-width: 1.6;
    vector-effect: non-scaling-stroke;
  }
  .mm { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--muted); }

  .edit {
    position: absolute;
    top: -9px;
    right: 8px;
    display: flex;
    gap: 4px;
    z-index: 2;
  }
  .edit button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 20px;
    padding: 0;
    color: var(--text);
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: 999px;
  }
  .edit .del { color: var(--danger); }
</style>
