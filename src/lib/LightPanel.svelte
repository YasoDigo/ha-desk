<script lang="ts">
  import { onMount } from "svelte";
  import { ha } from "$lib/ha";
  import type { HaEntity } from "$lib/ha";
  import { pctOf, setPct, lightCaps } from "$lib/tileKind";

  export let entityId: string;
  export let entity: HaEntity;

  let root: HTMLDivElement;
  let live: Record<string, number> = {};
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};

  onMount(() => root?.scrollIntoView({ block: "nearest", behavior: "smooth" }));

  $: caps = lightCaps(entity);
  $: unavailable = entity.state === "unavailable";

  $: curK = Number(entity.attributes.color_temp_kelvin ?? Math.round((caps.minK + caps.maxK) / 2));
  $: curHue = Number(entity.attributes.hs_color?.[0] ?? 0);
  $: curSat = Number(entity.attributes.hs_color?.[1] ?? 0);

  // Sürüklerken canlı değer, bırakınca HA'dan gelen değer
  $: bri = "bri" in live ? live.bri : pctOf(entity);
  $: kel = "kel" in live ? live.kel : curK;
  $: hue = "hue" in live ? live.hue : Math.round(curHue);
  $: sat = "sat" in live ? live.sat : Math.round(curSat);

  const run = (p: Promise<unknown>) => p.catch((e) => console.error(e));
  const turnOn = (data: Record<string, any>) => run(ha.callService("light", "turn_on", entityId, data));

  function drag(key: string, e: Event) {
    clearTimeout(timers[key]);
    live = { ...live, [key]: +(e.currentTarget as HTMLInputElement).value };
  }

  function release(key: string, send: (v: number) => void) {
    const v = live[key];
    if (v === undefined) return;
    send(v);
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => {
      const { [key]: _drop, ...rest } = live;
      live = rest;
    }, 800);
  }

  const HUE_GRAD =
    "linear-gradient(to right,hsl(0,100%,50%),hsl(60,100%,50%),hsl(120,100%,50%),hsl(180,100%,50%),hsl(240,100%,50%),hsl(300,100%,50%),hsl(360,100%,50%))";
  const KELVIN_GRAD = "linear-gradient(to right,#ff9d3c,#ffe2b8,#ffffff,#cfe3ff)";
</script>

<div class="panel" bind:this={root}>
  {#if unavailable}
    <p class="hint">Kullanılamıyor</p>
  {:else}
    {#if caps.brightness}
      <div class="ctl">
        <div class="lbl"><span>Parlaklık</span><b class:act={"bri" in live}>%{bri}</b></div>
        <input
          type="range" min="0" max="100" step="1" value={bri}
          on:input={(e) => drag("bri", e)}
          on:change={() => release("bri", (v) => run(setPct(entity, v)))}
        />
      </div>
    {/if}

    {#if caps.colorTemp}
      <div class="ctl">
        <div class="lbl"><span>Renk sıcaklığı</span><b class:act={"kel" in live}>{kel} K</b></div>
        <input
          type="range" class="grad" style="background:{KELVIN_GRAD}"
          min={caps.minK} max={caps.maxK} step="1" value={kel}
          on:input={(e) => drag("kel", e)}
          on:change={() => release("kel", (v) => turnOn({ color_temp_kelvin: v }))}
        />
      </div>
    {/if}

    {#if caps.color}
      <div class="ctl">
        <div class="lbl">
          <span>Renk</span>
          <span class="sw" style="background:hsl({hue},100%,{100 - sat / 2}%)"></span>
        </div>
        <div class="lbl sm"><span>Ton</span><b class:act={"hue" in live}>{hue}°</b></div>
        <input
          type="range" class="grad" style="background:{HUE_GRAD}"
          min="0" max="360" step="1" value={hue}
          on:input={(e) => drag("hue", e)}
          on:change={() => release("hue", (v) => turnOn({ hs_color: [v, sat] }))}
        />
        <div class="lbl sm"><span>Doygunluk</span><b class:act={"sat" in live}>%{sat}</b></div>
        <input
          type="range" class="grad"
          style="background:linear-gradient(to right,#ffffff,hsl({hue},100%,50%))"
          min="0" max="100" step="1" value={sat}
          on:input={(e) => drag("sat", e)}
          on:change={() => release("sat", (v) => turnOn({ hs_color: [hue, v] }))}
        />
      </div>
    {/if}

    {#if caps.effects.length}
      <div class="ctl">
        <div class="lbl"><span>Efekt</span></div>
        <select on:change={(e) => turnOn({ effect: e.currentTarget.value })}>
          {#each caps.effects as fx}
            <option value={fx} selected={fx === entity.attributes.effect}>{fx}</option>
          {/each}
        </select>
      </div>
    {/if}
  {/if}
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 12px; }
  .ctl { display: flex; flex-direction: column; gap: 6px; }
  .lbl { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
  .lbl.sm { font-size: 11px; opacity: 0.8; }
  .lbl b { font-variant-numeric: tabular-nums; opacity: 0.8; }
  .lbl b.act { color: var(--accent); opacity: 1; font-size: 14px; }
  .sw { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--border); }
  input[type="range"] { width: 100%; accent-color: var(--accent); }
  input[type="range"].grad {
    -webkit-appearance: none;
    appearance: none;
    height: 12px;
    padding: 0;
    border-radius: 6px;
    border: 1px solid var(--border);
  }
  input[type="range"].grad::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid #222;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
    cursor: pointer;
  }
  select { width: 100%; }
  .hint { opacity: 0.65; font-size: 13px; margin: 0; }
</style>
