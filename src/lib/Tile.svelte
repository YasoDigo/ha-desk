<script lang="ts">
  import { ha } from "$lib/ha";
  import type { HaEntity } from "$lib/ha";
  import {
    kindOf, domainOf, pctOf, setPct, press, hasDetail, activeOf, describe, EXTRA_KINDS,
  } from "$lib/tileKind";
  import { t } from "$lib/i18n";
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
  $: level = kind === "dimmer" ? shown : pct;
  $: glowStyle = rgb
    ? `--glow: rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]}); --gbg: ${Math.round(12 + 18 * (level / 100))}%; --gsh: ${Math.round(20 + 40 * (level / 100))}%;`
    : "";

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
  class:on
  class:colored={!!rgb}
  class:expanded
  class:clickable
  class:compact={kind === "button"}
  class:unavailable
  class:missing={loaded && !entity}
  class:has-det={canDetail && !editing}
  style={glowStyle}
  on:click={onTileClick}
>
  {#if editing}
    <div class="edit">
      <button on:click|stopPropagation={onSpan} title={span === 2 ? $t("tile.halve") : $t("tile.widen")}>
        {span === 2 ? "½" : "↔"}
      </button>
      <button class="del" on:click|stopPropagation={onRemove} title={$t("common.remove")}>✕</button>
    </div>
  {/if}

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

  <div class="head">
    <span class="name">{name}</span>
    {#if sub}<span class="sub">{sub}</span>{/if}
  </div>

  {#if entity && !unavailable}
    {#if kind === "dimmer" || kind === "number"}
      <div class="srow">
        <input
          type="range"
          min={kind === "dimmer" ? 0 : entity.attributes.min ?? 0}
          max={kind === "dimmer" ? 100 : entity.attributes.max ?? 100}
          step={kind === "dimmer" ? 1 : entity.attributes.step ?? 1}
          value={shown}
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
    position: relative;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    min-height: 64px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
  }
  .tile.clickable { cursor: pointer; }
  .tile.compact { min-height: 44px; padding: 8px 12px; justify-content: center; }
  .tile.on { background: var(--card-on); border-color: var(--accent); }
  .tile.on.colored {
    background: color-mix(in srgb, var(--glow) var(--gbg), var(--card));
    border-color: var(--glow);
    box-shadow: 0 0 14px color-mix(in srgb, var(--glow) var(--gsh), transparent);
  }
  .tile.colored .srow input[type="range"] { accent-color: var(--glow); }
  .tile.expanded { border-color: var(--accent); }
  .tile.unavailable { opacity: 0.5; }
  .tile.missing { border-style: dashed; opacity: 0.7; }

  .head { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .has-det .name { padding-right: 28px; }
  .name {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 11px;
    opacity: 0.65;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .srow { display: flex; align-items: center; gap: 8px; }
  .srow input[type="range"] { flex: 1; min-width: 0; accent-color: var(--accent); }
  .val {
    min-width: 44px;
    text-align: right;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
    transition: color 0.1s;
  }
  .val.active { opacity: 1; color: var(--accent); font-weight: 700; font-size: 14px; }

  select {
    width: 100%;
    padding: 4px 6px;
    background: var(--input-bg);
    color: inherit;
    border: 1px solid var(--border);
    border-radius: 6px;
  }

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

  .det {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--card) 70%, transparent);
    opacity: 0.9;
  }
  .det:hover { opacity: 1; }
  .det.open { color: var(--accent); border-color: var(--accent); }

  .inner { margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--border); }
</style>
