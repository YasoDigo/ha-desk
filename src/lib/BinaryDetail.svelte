<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { HaEntity } from "$lib/ha";
  import { fetchStates } from "$lib/history";
  import { binInfo } from "$lib/tileKind";
  import { t, tn, locale } from "$lib/i18n";
  import type { StatePoint } from "$lib/history";

  export let entityId: string;
  export let entity: HaEntity | undefined;
  export let onClose: () => void = () => {};

  type Bin = [string, string, boolean];

  const RANGES = [
    { h: 6, label: "range.6h" as const },
    { h: 24, label: "range.24h" as const },
    { h: 168, label: "range.7d" as const },
  ];

  type Seg = { from: number; to: number; s: string };

  let hours = 24;
  let list: StatePoint[] = [];
  let winStart = Date.now() - 24 * 3600_000;
  let winEnd = Date.now();
  let loading = true;
  let msg = "";
  let timer: ReturnType<typeof setInterval> | null = null;

  $: name = entity?.attributes.friendly_name ?? entityId;
  $: bin = binInfo(entity?.attributes.device_class, $t);
  $: state = entity?.state ?? "";
  $: active = state === "on";
  $: isAlert = active && bin[2];
  $: nowLabel = state === "on" ? bin[0] : state === "off" ? bin[1] : "—";

  const label = (s: string, b: Bin) => (s === "on" ? b[0] : s === "off" ? b[1] : tn("common.unknown"));
  const cls = (s: string, b: Bin) =>
    s === "on" ? (b[2] ? "alert" : "on") : s === "off" ? "off" : "dead";

  const fmtT = (t: number, h: number) =>
    new Date(t).toLocaleString(
      locale(),
      h > 24
        ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
        : { hour: "2-digit", minute: "2-digit" }
    );

  function fmtDur(ms: number): string {
    const m = Math.round(ms / 60000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return tn("dur.dh", { d, h: h % 24 });
    if (h > 0) return tn("dur.hm", { h, m: m % 60 });
    return tn("dur.m", { m });
  }

  const pos = (t: number, a: number, b: number) => ((t - a) / (b - a || 1)) * 100;

  // Durum değişikliklerinden, pencere içindeki kesintisiz aralıkları çıkarır
  function build(l: StatePoint[], start: number, end: number): Seg[] {
    const segs: Seg[] = [];
    for (let i = 0; i < l.length; i++) {
      const from = Math.max(l[i].t, start);
      const to = i + 1 < l.length ? l[i + 1].t : end;
      if (to <= from) continue;
      const last = segs[segs.length - 1];
      if (last && last.s === l[i].s) last.to = to;
      else segs.push({ from, to, s: l[i].s });
    }
    return segs;
  }

  async function load() {
    try {
      const end = Date.now();
      list = await fetchStates(entityId, hours);
      winEnd = end;
      winStart = end - hours * 3600_000;
      msg = list.length === 0 ? tn("bin.noRecord") : "";
    } catch (e) {
      list = [];
      msg = tn("sensor.histFail", { err: String(e) });
    }
    loading = false;
  }

  function setRange(h: number) {
    hours = h;
    list = [];
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

  $: segs = build(list, winStart, winEnd);
  $: onMs = segs.filter((s) => s.s === "on").reduce((a, s) => a + (s.to - s.from), 0);
  $: opened = segs.filter((s, i) => s.s === "on" && i > 0).length;
  $: changes = segs.slice(1).reverse().slice(0, 8);
</script>

<div class="sdetail">
  <div class="top">
    <div class="title">
      <span class="name">{name}</span>
      <span class="cur">
        <span class="dot" class:on={active} class:alert={isAlert}></span>{nowLabel}
      </span>
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
  {:else if msg}
    <p class="hint">{msg}</p>
  {:else}
    <div class="bar">
      {#each segs as sg}
        <div
          class="seg {cls(sg.s, bin)}"
          style="left: {pos(sg.from, winStart, winEnd)}%; width: {pos(sg.to, winStart, winEnd) - pos(sg.from, winStart, winEnd)}%"
          title="{label(sg.s, bin)} · {fmtT(sg.from, hours)} – {fmtT(sg.to, hours)}"
        ></div>
      {/each}
    </div>
    <div class="xlab"><span>{fmtT(winStart, hours)}</span><span>{$t("bin.now")}</span></div>

    <div class="stats">
      <div><span>{$t("bin.activeTime")}</span><b>{fmtDur(onMs)}</b></div>
      <div><span>{$t("bin.triggers")}</span><b>{opened}</b></div>
    </div>

    {#if changes.length}
      <ul class="log">
        {#each changes as c}
          <li>
            <span class="d {cls(c.s, bin)}"></span>
            <span class="l">{label(c.s, bin)}</span>
            <time>{fmtT(c.from, hours)}</time>
          </li>
        {/each}
      </ul>
    {/if}
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
  .title { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .name { font-size: 13px; opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cur { display: flex; align-items: center; gap: 8px; font-size: 24px; font-weight: 700; line-height: 1.1; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: #888; flex: none; }
  .dot.on { background: var(--accent); }
  .dot.alert { background: #e5484d; }
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

  .bar { position: relative; height: 30px; background: var(--bg); border-radius: 8px; overflow: hidden; }
  .seg { position: absolute; top: 0; bottom: 0; min-width: 2px; }
  .seg.on { background: var(--accent); }
  .seg.alert { background: #e5484d; }
  .seg.off { background: color-mix(in srgb, var(--text) 14%, var(--bg)); }
  .seg.dead {
    background: repeating-linear-gradient(
      45deg,
      color-mix(in srgb, var(--text) 18%, var(--bg)) 0 4px,
      var(--bg) 4px 8px
    );
  }
  .xlab { display: flex; justify-content: space-between; font-size: 10px; opacity: 0.6; }

  .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
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

  .log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .log li { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .log .l { flex: 1; }
  .log time { opacity: 0.65; font-variant-numeric: tabular-nums; }
  .d { width: 8px; height: 8px; border-radius: 50%; background: #888; flex: none; }
  .d.on { background: var(--accent); }
  .d.alert { background: #e5484d; }
  .d.dead { background: #666; }
</style>
