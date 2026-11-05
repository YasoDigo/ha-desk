<script lang="ts">
  import { ha } from "$lib/ha";
  import type { HaEntity } from "$lib/ha";
  import {
    kindOf, domainOf, pctOf, setPct, press, hasDetail, activeOf, describe, EXTRA_KINDS,
  } from "$lib/tileKind";
  import { t } from "$lib/i18n";
  import Icon from "$lib/Icon.svelte";
  import { iconOf } from "$lib/icons";
  import { marquee } from "$lib/marquee";
  import { inkFor } from "$lib/color";
  import LightPanel from "$lib/LightPanel.svelte";
  import ExtraControls from "$lib/ExtraControls.svelte";

  export let entityId: string;
  export let entity: HaEntity | undefined;
  export let loaded = false;
  export let editing = false;
  export let expanded = false;
  export let span: 1 | 2 = 1;
  export let onRemove: () => void = () => {};
  export let onDetail: () => void = () => {};
  export let onSpan: () => void = () => {};

  let dragging = false;
  let dragVal = 0;
  let dragTimer: ReturnType<typeof setTimeout> | null = null;

  $: kind = entity ? kindOf(entity) : null;
  $: name = entity?.attributes.friendly_name ?? entityId;
  $: on = entity ? activeOf(entity) : false;
  // perde ve kilit "açık" olsa da dolmaz: sadece çerçevesi yanar (dolu zemin yanan lambalara ait)
  $: soft = kind === "cover" || kind === "lock";
  $: isExtra = kind !== null && EXTRA_KINDS.includes(kind);
  $: canDetail = entity ? hasDetail(entity) : false;
  $: unavailable = entity?.state === "unavailable";
  $: unit = entity?.attributes.unit_of_measurement ?? "";
  $: pct = entity ? pctOf(entity) : 0;
  $: numState = entity ? Number(entity.state) : NaN;
  $: numVal = Number.isFinite(numState) ? numState : Number(entity?.attributes.min ?? 0);
  $: current = kind === "dimmer" ? pct : numVal;
  $: shown = dragging ? dragVal : current;
  $: valText = kind === "dimmer" ? `%${shown}` : `${shown}${unit ? " " + unit : ""}`;
  $: clickable = kind === "toggle" || kind === "dimmer" || kind === "button";

  // Işık açıkken kutucuk ışığın rengiyle parlar; yoğunluk parlaklığa göre değişir
  $: rgb =
    entity &&
    on &&
    domainOf(entityId) === "light" &&
    Array.isArray(entity.attributes.rgb_color) &&
    entity.attributes.rgb_color.length === 3
      ? (entity.attributes.rgb_color as number[])
      : null;
  // Renkli ışıkta kutucuk ışığın rengiyle dolar; yazı rengi o renge göre seçilir
  $: glowStyle = rgb ? `--glow: rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]}); --chip-ink: ${inkFor(rgb)};` : "";

  // Kaydırıcının dolu kısmı (yüzde)
  $: lo = kind === "dimmer" ? 0 : Number(entity?.attributes.min ?? 0);
  $: hi = kind === "dimmer" ? 100 : Number(entity?.attributes.max ?? 100);
  $: fillPct = hi > lo ? Math.max(0, Math.min(100, ((shown - lo) / (hi - lo)) * 100)) : 0;

  // "Çalıştır" gibi bilgi satırı sadece düzenleme modunda görünür
  $: sub = !entity
    ? loaded ? $t("common.notFound") : $t("common.loadingLc")
    : unavailable
      ? $t("state.unavailable")
      : kind === "toggle" || kind === "dimmer"
        ? on ? $t("state.on") : $t("state.off")
        : kind === "button"
          ? editing ? $t("tile.run") : ""
          : isExtra
            ? describe(entity, $t)
            : kind === "sensor"
              ? `${entity.state} ${unit}`
              : "";

  function run(p: Promise<unknown>) {
    p.catch((e) => console.error(e));
  }

  function tap() {
    if (!entity || editing) return;
    if (kind === "button") run(press(entity));
    else run(ha.callService("homeassistant", "toggle", entityId));
  }

  function onTileClick(e: MouseEvent) {
    if (editing || !entity || unavailable || !clickable) return;
    // slider, liste, düğme ve panel kendi tıklamalarını yönetir
    if ((e.target as HTMLElement).closest("input, select, button, .inner")) return;
    tap();
  }

  function onInput(e: Event) {
    if (dragTimer) clearTimeout(dragTimer);
    dragging = true;
    dragVal = +(e.currentTarget as HTMLInputElement).value;
  }

  function onChange(e: Event) {
    const v = +(e.currentTarget as HTMLInputElement).value;
    if (entity) {
      if (kind === "dimmer") run(setPct(entity, v));
      else if (kind === "number")
        run(ha.callService(domainOf(entityId), "set_value", entityId, { value: v }));
    }
    // durum HA'dan geri gelene kadar kaydırıcı yerinde kalsın
    if (dragTimer) clearTimeout(dragTimer);
    dragTimer = setTimeout(() => (dragging = false), 800);
  }

  function onSelect(e: Event) {
    const option = (e.currentTarget as HTMLSelectElement).value;
    run(ha.callService(domainOf(entityId), "select_option", entityId, { option }));
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="tile"
  class:on={on && !soft}
  class:ring={on && soft}
  class:colored={!!rgb}
  class:expanded
  class:clickable
  class:compact={kind === "button"}
  class:unavailable
  class:missing={loaded && !entity}
  style={glowStyle}
  on:click={onTileClick}
>
  {#if editing}
    <div class="edit">
      <button on:click|stopPropagation={onSpan} title={span === 2 ? $t("tile.halve") : $t("tile.widen")}>
        <Icon name={span === 2 ? "shrink" : "expand"} size={13} />
      </button>
      <button class="del" on:click|stopPropagation={onRemove} title={$t("common.remove")}><Icon name="close" size={12} /></button>
    </div>
  {/if}

  <div class="top">
    <span class="chip"><Icon name={iconOf(entityId)} size={18} /></span>
    {#if canDetail && !editing}
      <button
        class="det"
        class:open={expanded}
        on:click|stopPropagation={onDetail}
        title={expanded ? $t("common.close") : $t("tile.details")}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2.2" fill="currentColor" />
          <line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2.2" fill="currentColor" />
          <line x1="4" y1="17" x2="20" y2="17" /><circle cx="8" cy="17" r="2.2" fill="currentColor" />
        </svg>
      </button>
    {/if}
  </div>

  <div class="head">
    <span class="name mq" use:marquee={name}><span class="mi">{name}</span></span>
    {#if sub}<span class="sub">{sub}</span>{/if}
  </div>

  {#if entity && !unavailable}
    {#if kind === "dimmer" || kind === "number"}
      <div class="srow">
        <input
          class="fader"
          type="range"
          min={kind === "dimmer" ? 0 : entity.attributes.min ?? 0}
          max={kind === "dimmer" ? 100 : entity.attributes.max ?? 100}
          step={kind === "dimmer" ? 1 : entity.attributes.step ?? 1}
          value={shown}
          style="--p: {fillPct}%"
          on:input={onInput}
          on:change={onChange}
        />
        <span class="val" class:active={dragging}>{valText}</span>
      </div>
    {:else if kind === "select"}
      <select on:change={onSelect}>
        {#each entity.attributes.options ?? [] as o}
          <option value={o} selected={o === entity.state}>{o}</option>
        {/each}
      </select>
    {:else if isExtra}
      <ExtraControls {entityId} {entity} disabled={editing} />
    {/if}
  {/if}

  {#if expanded && entity && canDetail}
    <div class="inner"><LightPanel {entityId} {entity} /></div>
  {/if}
</div>

<style>
  .tile {
    /* kutucuk içindeki denetimlerin kullandığı renkler; açık durumda ters çevrilir */
    --tile-bg: var(--plate);
    --btn: var(--raised);
    --trk: var(--field);
    --fill: var(--accent);
    position: relative;
    min-width: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 10px;
    row-gap: 8px;
    padding: 10px 12px;
    background: var(--tile-bg);
    color: var(--text);
    border-radius: var(--r-tile);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 7%, transparent);
    transition: background 0.2s var(--ease), color 0.2s var(--ease), box-shadow 0.25s var(--ease),
      transform 0.12s var(--ease);
  }
  .tile.clickable { cursor: pointer; }
  .tile.clickable:active { transform: scale(0.985); }
  .tile.unavailable { opacity: 0.5; }
  .tile.missing { box-shadow: inset 0 0 0 1.5px var(--line); background: transparent; opacity: 0.75; }

  /* açık kutucuk: zemin hafifçe boyanır, ikon rozeti yanar (lambada kendi rengiyle) */
  .tile.on {
    --chipc: var(--accent);
    --chip-ink: var(--on-accent);
    --tile-bg: var(--on-tint);
    --btn: color-mix(in srgb, var(--chipc) 16%, var(--raised));
    --trk: color-mix(in srgb, var(--chipc) 14%, var(--field));
    --fill: var(--chipc);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--chipc) 28%, transparent);
  }
  .tile.on.colored {
    --chipc: var(--glow);
    --tile-bg: color-mix(in srgb, var(--glow) 13%, var(--plate));
  }
  .tile.ring {
    background: var(--on-tint);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .tile.ring .chip { color: var(--accent-text); }

  .top { display: contents; }
  .chip { grid-column: 1; grid-row: 1; }
  .head { grid-column: 2; grid-row: 1; }
  .det { grid-column: 3; grid-row: 1; }
  .tile > :global(:not(.top):not(.head):not(.edit)) { grid-column: 1 / -1; }
  .chip {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    background: var(--btn);
    color: var(--muted);
    transition: background 0.2s var(--ease), color 0.2s var(--ease);
  }
  .tile.on .chip {
    background: var(--chipc);
    color: var(--chip-ink);
    box-shadow: 0 0 14px -2px color-mix(in srgb, var(--chipc) 70%, transparent);
  }

  .head { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .name {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 11.5px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }


  .srow { display: flex; align-items: center; gap: 8px; }
  .srow .fader { flex: 1; min-width: 0; }
  .val {
    min-width: 40px;
    text-align: right;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }
  .val.active { opacity: 1; font-weight: 700; }

  select {
    width: 100%;
    padding: 6px 9px;
    font-size: 12.5px;
    border-radius: 9px;
    background: var(--btn);
    color: inherit;
  }
  select option { color: var(--text); background: var(--plate); }

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

  .det {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 9px;
    background: transparent;
    color: inherit;
    opacity: 0.7;
  }
  .det:hover { opacity: 1; background: var(--btn) !important; }
  .det.open { opacity: 1; background: var(--btn); }

  .inner { padding-top: 10px; border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent); }
</style>
