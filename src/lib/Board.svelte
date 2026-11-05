<script lang="ts">
  import { dndzone, SHADOW_ITEM_MARKER_PROPERTY_NAME } from "svelte-dnd-action";
  import { flip } from "svelte/animate";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { invoke } from "@tauri-apps/api/core";
  import { ha, activeUrl } from "$lib/ha";
  import type { HaEntity } from "$lib/ha";
  import type { Group, Tile as TileData, BoardOps } from "$lib/config";
  import { kindOf } from "$lib/tileKind";
  import Tile from "$lib/Tile.svelte";
  import SensorTile from "$lib/SensorTile.svelte";
  import SensorDetail from "$lib/SensorDetail.svelte";
  import BinaryDetail from "$lib/BinaryDetail.svelte";
  import { t as tt } from "$lib/i18n";

  export let kind: "tiles" | "sensors" = "tiles";
  export let groupsValue: Group[] = [];
  export let ops: BoardOps;
  export let ents: Record<string, HaEntity> = {};
  export let loaded = false;
  export let editing = false;
  export let onPick: (gid: string) => void = () => {};
  export let onDetail: (entityId: string) => void = () => {};

  const FLIP_MS = 150;

  // Sürüklerken yalnızca ekrandaki kopya değişir; bırakınca kaydedilir
  let local: Group[] = [];
  $: local = groupsValue;

  // Sensör detay katmanı
  let openId: string | null = null;
  $: if (editing) openId = null;
  $: if (openId && !ents[openId]) openId = null;

  function isNumericSensor(e: HaEntity | undefined): boolean {
    return (
      !!e && e.entity_id.startsWith("sensor.") && e.state !== "" && Number.isFinite(Number(e.state))
    );
  }

  const isBinarySensor = (e: HaEntity | undefined) => !!e && e.entity_id.startsWith("binary_sensor.");
  const canOpen = (e: HaEntity | undefined) => isNumericSensor(e) || isBinarySensor(e);

  function openSensor(t: TileData) {
    if (kind !== "sensors" || editing) return;
    if (canOpen(ents[t.entity_id])) openId = t.entity_id;
  }

  // HA'nın kendi geçmiş sayfasını varsayılan tarayıcıda açar
  function openInHa(id: string) {
    if (!$activeUrl) return;
    invoke("open_url", {
      url: `${$activeUrl}/history?entity_id=${encodeURIComponent(id)}`,
    }).catch((e) => console.error(e));
  }

  function onConsider(gid: string, e: CustomEvent<{ items: TileData[] }>) {
    local = local.map((g) => (g.id === gid ? { ...g, tiles: e.detail.items } : g));
  }

  function onFinalize(gid: string, e: CustomEvent<{ items: TileData[] }>) {
    const clean = e.detail.items
      .filter((t) => !(t as any)[SHADOW_ITEM_MARKER_PROPERTY_NAME])
      .map(({ id, entity_id, span }) => ({ id, entity_id, span }));
    ops.setGroupTiles(gid, clean);
  }

  function onGroupConsider(e: CustomEvent<{ items: Group[] }>) {
    local = e.detail.items;
  }

  function onGroupFinalize(e: CustomEvent<{ items: Group[] }>) {
    const clean = e.detail.items
      .filter((g) => !(g as any)[SHADOW_ITEM_MARKER_PROPERTY_NAME])
      .map(({ id, title, tiles, master }) => ({ id, title, tiles, master }));
    ops.setGroups(clean);
  }

  // Toplu anahtara bağlı kutucukların entity_id listesi
  function memberIds(g: Group): string[] {
    const set = new Set(g.master);
    return g.tiles.filter((t) => set.has(t.id)).map((t) => t.entity_id);
  }

  function groupOn(g: Group, e: Record<string, HaEntity>): boolean {
    return memberIds(g).some((id) => e[id]?.state === "on");
  }

  function toggleGroup(g: Group) {
    const ids = memberIds(g);
    if (!ids.length) return;
    ha.call({
      type: "call_service",
      domain: "homeassistant",
      service: groupOn(g, ents) ? "turn_off" : "turn_on",
      service_data: {},
      target: { entity_id: ids },
    }).catch((e) => console.error(e));
  }

  // Sadece açılıp kapanabilen kutucuklar toplu anahtara bağlanabilir
  function linkable(t: TileData, e: Record<string, HaEntity>): boolean {
    const en = e[t.entity_id];
    if (!en) return false;
    const k = kindOf(en);
    return k === "toggle" || k === "dimmer";
  }
</script>

<svelte:window on:keydown={(e) => { if (e.key === "Escape") openId = null; }} />

{#if !groupsValue.some((g) => g.tiles.length) && !editing}
  <p class="hint">
    {kind === "tiles" ? $tt("board.emptyTiles") : $tt("board.emptySensors")}
  </p>
{/if}

<div
  class="groups"
  use:dndzone={{
    items: local,
    flipDurationMs: FLIP_MS,
    type: "group",
    dragDisabled: !editing,
    dropTargetStyle: {},
  }}
  on:consider={onGroupConsider}
  on:finalize={onGroupFinalize}
>
  {#each local as g (g.id)}
    <section
      class="group"
      class:hide={!editing && g.tiles.length === 0}
      animate:flip={{ duration: FLIP_MS }}
    >
      {#if editing}
        <div class="ghead">
          <span class="grip" title={$tt("board.dragGroup")}>⠿</span>
          <input
            class="gtitle"
            value={g.title}
            placeholder={$tt("board.groupTitle")}
            on:change={(e) => ops.renameGroup(g.id, e.currentTarget.value)}
          />
          {#if kind === "tiles"}
            <span class="gm" title={$tt("board.masterCount")}>⏻ {g.master.length}</span>
          {/if}
          <button class="icon" title={$tt("common.add")} on:click={() => onPick(g.id)}>+</button>
          {#if local.length > 1}
            <button class="icon" title={$tt("board.deleteGroup")} on:click={() => ops.removeGroup(g.id)}>✕</button>
          {/if}
        </div>
      {:else if g.title || (kind === "tiles" && memberIds(g).length)}
        <div class="gview-row">
          <h4 class="gview">{g.title}</h4>
          {#if kind === "tiles" && memberIds(g).length}
            <button
              class="gswitch"
              class:on={groupOn(g, ents)}
              on:click={() => toggleGroup(g)}
              title={$tt("board.masterToggle")}
              aria-label={$tt("board.masterAria")}
            ><span class="knob"></span></button>
          {/if}
        </div>
      {/if}

      <div
        class="grid"
        class:editing
        use:dndzone={{
          items: g.tiles,
          flipDurationMs: FLIP_MS,
          type: "tile",
          dragDisabled: !editing,
          dropTargetStyle: { outline: "2px dashed var(--accent)", "outline-offset": "-2px" },
        }}
        on:consider={(e) => onConsider(g.id, e)}
        on:finalize={(e) => onFinalize(g.id, e)}
      >
        {#each g.tiles as t (t.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div
            class="cell"
            class:clickable={kind === "sensors" && !editing && canOpen(ents[t.entity_id])}
            style="grid-column: span {t.span === 2 ? 2 : 1}"
            animate:flip={{ duration: FLIP_MS }}
            on:click={() => openSensor(t)}
          >
            {#if kind === "tiles"}
              {#if editing && linkable(t, ents)}
                <button
                  class="link"
                  class:on={g.master.includes(t.id)}
                  title={$tt("board.link")}
                  on:click|stopPropagation={() => ops.toggleMaster(g.id, t.id)}
                >⏻</button>
              {/if}
              <Tile
                entityId={t.entity_id}
                entity={ents[t.entity_id]}
                {loaded}
                {editing}
                span={t.span === 2 ? 2 : 1}
                onRemove={() => ops.removeTile(t.id)}
                onDetail={() => onDetail(t.entity_id)}
                onSpan={() => ops.setTileSpan(t.id, t.span === 2 ? 1 : 2)}
              />
            {:else}
              <SensorTile
                entityId={t.entity_id}
                entity={ents[t.entity_id]}
                {loaded}
                {editing}
                span={t.span === 2 ? 2 : 1}
                onRemove={() => ops.removeTile(t.id)}
                onSpan={() => ops.setTileSpan(t.id, t.span === 2 ? 1 : 2)}
              />
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/each}
</div>

{#if editing}
  <button class="add" on:click={() => ops.addGroup()}>{$tt("board.addGroup")}</button>
{/if}

{#if kind === "sensors" && openId && ents[openId]}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" transition:fade={{ duration: 220 }} on:click|self={() => (openId = null)}>
    <div
      class="focus"
      in:fly|global={{ y: 14, duration: 280, easing: cubicOut }}
      out:fade|global={{ duration: 120 }}
    >
      {#if openId.startsWith("binary_sensor.")}
        <BinaryDetail entityId={openId} entity={ents[openId]} onClose={() => (openId = null)} />
      {:else}
        <SensorDetail entityId={openId} entity={ents[openId]} onClose={() => (openId = null)} />
      {/if}
      {#if $activeUrl}
        <button class="halink" on:click={() => openInHa(openId ?? "")}>{$tt("board.openHa")}</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .hint { opacity: 0.65; font-size: 13px; }

  .group { margin-bottom: 14px; }
  .group.hide { display: none; }

  .gview-row { display: flex; align-items: center; justify-content: space-between; margin: 0 2px 6px 2px; }
  .gview { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; opacity: 0.7; }

  .ghead { display: flex; gap: 4px; align-items: center; margin-bottom: 6px; }
  .gtitle,
  .icon,
  .add {
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: inherit;
    font-size: 13px;
    font-family: inherit;
  }
  .gtitle { flex: 1; min-width: 0; font-weight: 600; }
  .icon { padding: 3px 9px; font-size: 14px; cursor: pointer; }
  .icon:hover { background: var(--hover); }
  .gm { font-size: 12px; opacity: 0.7; white-space: nowrap; user-select: none; }
  .grip {
    padding: 3px 9px;
    font-size: 14px;
    cursor: grab;
    user-select: none;
    border: 1px solid var(--input-border);
    border-radius: 8px;
    background: var(--input-bg);
  }

  .gswitch {
    position: relative;
    width: 36px;
    height: 20px;
    padding: 0;
    border-radius: 10px;
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    cursor: pointer;
  }
  .gswitch .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--text);
    opacity: 0.7;
    transition: transform 0.18s, background 0.18s;
  }
  .gswitch.on { background: var(--accent); border-color: var(--accent); }
  .gswitch.on .knob { transform: translateX(16px); background: #1a1a1a; opacity: 1; }

  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 8px; }
  .grid.editing { min-height: 56px; padding: 6px; border: 1px dashed var(--border); border-radius: 12px; }
  .cell { position: relative; min-width: 0; display: flex; }
  .cell.clickable { cursor: pointer; }
  .cell > :global(.tile),
  .cell > :global(.stile) { flex: 1; min-width: 0; }
  .grid.editing .cell :global(input),
  .grid.editing .cell :global(select) { pointer-events: none; }

  .link {
    position: absolute;
    top: -8px;
    left: 6px;
    z-index: 3;
    padding: 1px 6px;
    font-size: 12px;
    border-radius: 6px;
    background: #444;
    color: #fff;
    border: 1px solid #666;
    cursor: pointer;
  }
  .link.on { background: var(--accent); color: #1a1a1a; border-color: var(--accent); }

  .add {
    width: 100%;
    min-height: 64px;
    border-style: dashed;
    background: transparent;
    border-radius: 12px;
    opacity: 0.8;
    cursor: pointer;
  }

  /* sensör detayı: bulanık arkaplan üstünde odaklanmış kart */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 56px 12px 12px;
    overflow-y: auto;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(8px);
  }
  .focus {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .focus > :global(.sdetail) {
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  }
  .halink {
    align-self: flex-end;
    padding: 5px 12px;
    font-size: 12px;
    font-family: inherit;
    color: inherit;
    border: 1px solid var(--input-border);
    border-radius: 8px;
    background: var(--input-bg);
    cursor: pointer;
  }
  .halink:hover { background: var(--hover); }
</style>
