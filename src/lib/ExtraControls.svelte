<script lang="ts">
  import { onDestroy } from "svelte";
  import { ha } from "$lib/ha";
  import type { HaEntity } from "$lib/ha";
  import { kindOf, domainOf, hvacLabel } from "$lib/tileKind";
  import { t } from "$lib/i18n";
  import Icon from "$lib/Icon.svelte";

  // Perde, kilit, klima ve medya oynatıcı kontrolleri
  export let entityId: string;
  export let entity: HaEntity;
  export let disabled = false;

  $: kind = kindOf(entity);
  $: a = entity.attributes;
  $: s = entity.state;
  $: feat = Number(a.supported_features ?? 0);
  const has = (f: number, bit: number) => (f & bit) !== 0;

  function call(service: string, data: Record<string, any> = {}) {
    if (disabled) return;
    ha.callService(domainOf(entityId), service, entityId, data).catch((e) => console.error(e));
  }

  // ---------- perde ----------
  $: cOpen = has(feat, 1) || feat === 0;
  $: cClose = has(feat, 2) || feat === 0;
  $: cStop = has(feat, 8);
  $: posNow = typeof a.current_position === "number" ? Math.round(a.current_position) : null;
  $: cPos = has(feat, 4) && posNow !== null;

  let posDrag: number | null = null;
  let posTimer: ReturnType<typeof setTimeout> | null = null;
  $: posShown = posDrag ?? posNow ?? 0;

  function onPosInput(e: Event) {
    if (posTimer) clearTimeout(posTimer);
    posDrag = +(e.currentTarget as HTMLInputElement).value;
  }
  function onPosChange(e: Event) {
    call("set_cover_position", { position: +(e.currentTarget as HTMLInputElement).value });
    if (posTimer) clearTimeout(posTimer);
    posTimer = setTimeout(() => (posDrag = null), 800);
  }

  // ---------- kilit ----------
  // Kilidi açmak için iki aşamalı onay (yanlışlıkla tıklamaya karşı)
  let confirm = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  $: busy = s === "locking" || s === "unlocking";

  function toggleLock() {
    if (disabled || busy) return;
    if (s === "locked") {
      if (!confirm) {
        confirm = true;
        if (confirmTimer) clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => (confirm = false), 3000);
        return;
      }
      confirm = false;
      call("unlock");
    } else {
      call("lock");
    }
  }

  // ---------- klima ----------
  $: attrTarget = typeof a.temperature === "number" ? a.temperature : null;
  $: step = Number(a.target_temp_step) > 0 ? Number(a.target_temp_step) : 0.5;
  $: minT = Number.isFinite(Number(a.min_temp)) && a.min_temp != null ? Number(a.min_temp) : 7;
  $: maxT = Number.isFinite(Number(a.max_temp)) && a.max_temp != null ? Number(a.max_temp) : 35;
  $: modes = (Array.isArray(a.hvac_modes) ? a.hvac_modes : []) as string[];

  let pending: number | null = null;
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  $: target = pending ?? attrTarget ?? 0;

  function nudge(dir: 1 | -1) {
    const base = pending ?? attrTarget;
    if (disabled || base === null) return;
    const next = Number(Math.min(maxT, Math.max(minT, base + dir * step)).toFixed(2));
    pending = next;
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      call("set_temperature", { temperature: next });
      // HA yeni değeri bildirene kadar yerel değer görünsün
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => (pending = null), 1500);
    }, 600);
  }

  // ---------- medya oynatıcı ----------
  $: mOff = s === "off";
  $: mPower = has(feat, 128) || has(feat, 256);
  $: mPrev = has(feat, 16);
  $: mNext = has(feat, 32);
  $: mPlay = has(feat, 1) || has(feat, 16384) || feat === 0;
  $: mVol = has(feat, 4) && typeof a.volume_level === "number";
  $: mSrc = has(feat, 2048) && Array.isArray(a.source_list) ? (a.source_list as string[]) : [];
  $: volNow = typeof a.volume_level === "number" ? Math.round(a.volume_level * 100) : 0;

  let volDrag: number | null = null;
  let volTimer: ReturnType<typeof setTimeout> | null = null;
  $: volShown = volDrag ?? volNow;

  function onVolInput(e: Event) {
    if (volTimer) clearTimeout(volTimer);
    volDrag = +(e.currentTarget as HTMLInputElement).value;
  }
  function onVolChange(e: Event) {
    call("volume_set", { volume_level: +(e.currentTarget as HTMLInputElement).value / 100 });
    if (volTimer) clearTimeout(volTimer);
    volTimer = setTimeout(() => (volDrag = null), 800);
  }

  function onSource(e: Event) {
    const source = (e.currentTarget as HTMLSelectElement).value;
    if (source) call("select_source", { source });
  }

  // HA bazı oynatıcıları (Spotify gibi) yavaş yoklar; durumu hemen yenilemek için
  let refreshing = false;
  function refresh() {
    if (disabled || refreshing) return;
    refreshing = true;
    ha.callService("homeassistant", "update_entity", entityId)
      .catch((e) => console.error(e))
      .finally(() => (refreshing = false));
  }

  // Popup/palet açılınca (pencere odak alınca) medya durumu bir kez yenilenir
  let lastAuto = 0;
  function onFocus() {
    if (kind !== "media" || disabled || Date.now() - lastAuto < 5000) return;
    lastAuto = Date.now();
    refresh();
  }

  onDestroy(() => {
    for (const t of [posTimer, confirmTimer, sendTimer, clearTimer, volTimer]) if (t) clearTimeout(t);
  });
</script>

<svelte:window on:focus={onFocus} />

{#if kind === "cover"}
  <div class="btns">
    {#if cOpen}
      <button {disabled} title={$t("cover.open")} on:click={() => call("open_cover")}><Icon name="up" /></button>
    {/if}
    {#if cStop}
      <button {disabled} title={$t("cover.stop")} on:click={() => call("stop_cover")}><Icon name="stop" /></button>
    {/if}
    {#if cClose}
      <button {disabled} title={$t("cover.close")} on:click={() => call("close_cover")}><Icon name="down" /></button>
    {/if}
  </div>
  {#if cPos}
    <div class="srow">
      <input type="range" class="fader" style="--p: {posShown}%" min="0" max="100" step="1" value={posShown} {disabled} on:input={onPosInput} on:change={onPosChange} />
      <span class="val" class:active={posDrag !== null}>%{posShown}</span>
    </div>
  {/if}
{:else if kind === "lock"}
  <div class="btns">
    <button class="txt" class:warn={confirm} disabled={disabled || busy} on:click={toggleLock}>
      {s === "locked" ? (confirm ? $t("lock.confirm") : $t("lock.unlock")) : $t("lock.lock")}
    </button>
  </div>
{:else if kind === "climate"}
  {#if attrTarget !== null}
    <div class="temp">
      <button {disabled} title={$t("climate.dec")} on:click={() => nudge(-1)}><Icon name="minus" /></button>
      <span class="tv">{target.toFixed(step < 1 ? 1 : 0)}°</span>
      <button {disabled} title={$t("climate.inc")} on:click={() => nudge(1)}><Icon name="plus" /></button>
    </div>
  {/if}
  {#if modes.length > 1}
    <div class="chips">
      {#each modes as m}
        <button class="chip" class:cur={m === s} {disabled} on:click={() => call("set_hvac_mode", { hvac_mode: m })}>
          {hvacLabel(m, $t)}
        </button>
      {/each}
    </div>
  {/if}
{:else if kind === "media"}
  <div class="btns">
    {#if mPower}
      <button {disabled} title={mOff ? $t("media.on") : $t("media.off")} on:click={() => call(mOff ? "turn_on" : "turn_off")}>
        <Icon name="power" />
      </button>
    {/if}
    {#if !mOff && mPrev}
      <button {disabled} title={$t("media.prev")} on:click={() => call("media_previous_track")}><Icon name="prev" /></button>
    {/if}
    {#if !mOff && mPlay}
      <button {disabled} title={s === "playing" ? $t("media.pause") : $t("media.play")} on:click={() => call("media_play_pause")}>
        <Icon name={s === "playing" ? "pause" : "play"} />
      </button>
    {/if}
    {#if !mOff && mNext}
      <button {disabled} title={$t("media.next")} on:click={() => call("media_next_track")}><Icon name="next" /></button>
    {/if}
    <button class="ref" class:spin={refreshing} disabled={disabled || refreshing} title={$t("media.refresh")} on:click={refresh}>
      <Icon name="refresh" />
    </button>
  </div>
  {#if !mOff && mSrc.length}
    <select class="src" {disabled} on:change={onSource}>
      <option value="" disabled selected={!a.source}>{$t("media.source")}</option>
      {#each mSrc as o}
        <option value={o} selected={o === a.source}>{o}</option>
      {/each}
    </select>
  {/if}
  {#if !mOff && mVol}
    <div class="srow">
      <input type="range" class="fader" style="--p: {volShown}%" min="0" max="100" step="1" value={volShown} {disabled} on:input={onVolInput} on:change={onVolChange} />
      <span class="val" class:active={volDrag !== null}>%{volShown}</span>
    </div>
  {/if}
{/if}

<style>
  .btns,
  .temp,
  .chips { display: flex; gap: 6px; align-items: center; }
  .btns button,
  .temp button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px 0;
    border-radius: var(--r-ctl);
    border: 0;
    background: var(--btn, var(--raised));
    color: inherit;
  }
  .btns button:hover:not(:disabled),
  .temp button:hover:not(:disabled) { background: color-mix(in srgb, var(--btn, var(--raised)) 70%, currentColor); }
  .temp button { flex: none; width: 40px; }
  .btns .txt { font-size: 12.5px; font-weight: 600; }
  .btns .ref:only-child { flex: 0 0 auto; padding: 6px 18px; }
  .btns .warn { background: var(--danger); color: #fff; }

  .spin :global(svg) { animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .src {
    width: 100%;
    padding: 5px 8px;
    font-size: 12px;
    background: var(--btn, var(--raised));
    color: inherit;
    border: 0;
    border-radius: var(--r-ctl);
  }

  .temp { justify-content: center; gap: 10px; }
  .tv {
    min-width: 72px;
    text-align: center;
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 300;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }

  .chips { flex-wrap: wrap; gap: 4px; }
  .chip {
    padding: 3px 10px;
    font-size: 11.5px;
    border-radius: 999px;
    border: 0;
    background: var(--btn, var(--raised));
    color: inherit;
  }
  .chip.cur { background: var(--accent); color: var(--on-accent); font-weight: 600; }

  .srow { display: flex; align-items: center; gap: 8px; }
  .srow .fader { flex: 1; min-width: 0; }
  .val { min-width: 40px; text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; opacity: 0.8; }
  .val.active { opacity: 1; font-weight: 700; }
</style>
