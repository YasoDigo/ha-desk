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
    gap: 12px;
    padding: 16px;
    background: var(--plate);
    border-radius: 22px;
    box-shadow: inset 0 0 0 1.5px var(--accent);
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

  .cur { display: flex; align-items: center; gap: 10px; font-size: 24px; font-weight: 600; line-height: 1.1; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--line); flex: none; }
  .dot.on { background: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent); }
  .dot.alert { background: var(--danger); box-shadow: 0 0 0 4px color-mix(in srgb, var(--danger) 25%, transparent); }

  .bar { position: relative; height: 30px; background: var(--field); border-radius: 10px; overflow: hidden; }
  .seg { position: absolute; top: 0; bottom: 0; min-width: 2px; }
  .seg.on { background: var(--accent); }
  .seg.alert { background: var(--danger); }
  .seg.off { background: color-mix(in srgb, var(--text) 12%, var(--field)); }
  .seg.dead {
    background: repeating-linear-gradient(
      45deg,
      color-mix(in srgb, var(--text) 18%, var(--field)) 0 4px,
      var(--field) 4px 8px
    );
  }
  .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }

  .log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .log li { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .log .l { flex: 1; }
  .log time { color: var(--muted); font-variant-numeric: tabular-nums; }
  .d { width: 8px; height: 8px; border-radius: 50%; background: var(--line); flex: none; }
  .d.on { background: var(--accent); }
  .d.alert { background: var(--danger); }
  .d.dead { background: var(--muted); }
</style>
