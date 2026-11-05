<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { ha, status, entities, lastError, activeUrl } from "$lib/ha";
  import type { HaEntity } from "$lib/ha";
  import type { ActionKind } from "$lib/shortcuts";
  import {
    groups, sensorGroups, usedEntities, usedSensors, settings, shortcuts, initConfig,
    tileOps, sensorOps, exportJson, importJson,
  } from "$lib/config";
  import {
    shortcutErrors, startShortcuts, pauseShortcuts, resumeShortcuts, addShortcut, removeShortcut,
    patchShortcut, setKind, setEntity, setStep, setValue, actionKind, needsEntity, entityOf,
    stepOf, valueOf, prettyKeys, conflictIndex, ACTION_OPTIONS,
  } from "$lib/shortcuts";
  import { domainOf } from "$lib/tileKind";
  import Tile from "$lib/Tile.svelte";
  import Board from "$lib/Board.svelte";
  import NotifyPanel from "$lib/NotifyPanel.svelte";
  import { startNotifications } from "$lib/notify";
  import { t, tn } from "$lib/i18n";
  import { startMobile } from "$lib/mobile";

  const SENSOR_DOMAINS = ["sensor", "binary_sensor"];

  let ready = false;
  let view: "tiles" | "settings" = "tiles";
  let section: "tiles" | "sensors" = "tiles";
  let tab: "baglanti" | "genel" | "kisayol" | "bildirim" | "yedek" = "baglanti";
  let editing = false;
  let picking = false;
  let pinned = false;
  let detailId: string | null = null;
  let pickGroup = "";
  let filter = "";
  let domainFilter = "";

  let hasToken = false;
  let primary = "";
  let fallback = "";
  let tokenInput = "";
  let backupText = "";
  let backupMsg = "";
  let autostart = false;

  let recordingId: string | null = null;
  let recordMsg = "";

  const urlList = () => [primary, fallback].map((u) => u.trim()).filter(Boolean);

  function loadDrafts() {
    primary = $settings.connection.primaryUrl;
    fallback = $settings.connection.fallbackUrl;
  }

  onMount(async () => {
    await initConfig();
    loadDrafts();
    startShortcuts();
    startNotifications();
    startMobile();
    try { autostart = await isEnabled(); } catch {}
    const t = (await invoke("get_token")) as string | null;
    hasToken = !!t;
    ready = true;
    if (t && urlList().length) ha.connect(urlList(), t);
    else view = "settings";
  });

  async function saveConnection() {
    settings.update((s) => ({
      ...s,
      connection: { primaryUrl: primary.trim(), fallbackUrl: fallback.trim() },
    }));
    try {
      if (tokenInput.trim()) {
        await invoke("set_token", { token: tokenInput.trim() });
        tokenInput = "";
      }
      const t = (await invoke("get_token")) as string | null;
      hasToken = !!t;
      if (t && urlList().length) ha.connect(urlList(), t);
    } catch (e) {
      lastError.set(String(e));
    }
  }

  async function forgetToken() {
    ha.disconnect();
    await invoke("delete_token");
    hasToken = false;
    editing = false;
    picking = false;
  }

  async function toggleAutostart(e: Event) {
    const want = (e.currentTarget as HTMLInputElement).checked;
    try {
      if (want) await enable();
      else await disable();
    } catch (err) {
      lastError.set(String(err));
    }
    try { autostart = await isEnabled(); } catch { autostart = false; }
  }

  async function doExport() {
    backupText = exportJson();
    try {
      await navigator.clipboard.writeText(backupText);
      backupMsg = tn("backup.copied");
    } catch {
      backupMsg = tn("backup.manual");
    }
  }

  async function doImport() {
    try {
      importJson(backupText);
      loadDrafts();
      backupMsg = tn("backup.imported");
      const t = (await invoke("get_token")) as string | null;
      if (t && urlList().length) ha.connect(urlList(), t);
    } catch (e) {
      backupMsg = tn("common.error", { msg: String(e) });
    }
  }

  // Sabitleyince popup dışarı tıklayınca kapanmaz
  function togglePin() {
    pinned = !pinned;
    invoke("set_pinned", { pinned }).catch((e) => console.error(e));
  }

  // Popup odağı kaybedince (sabit değilse) kapanır; bir sonraki açılışta ana ekran gelsin.
  // İlk kurulumda (token/adres yokken) ayarlarda kalır.
  function onWindowBlur() {
    stopRecord();
    if (!pinned && view === "settings" && hasToken && urlList().length) {
      view = "tiles";
      editing = false;
      picking = false;
      detailId = null;
    }
  }

  // ---- kısayol tuşu kaydı ----

  async function startRecord(id: string) {
    recordMsg = "";
    recordingId = id;
    await pauseShortcuts();
  }

  async function stopRecord() {
    if (!recordingId) return;
    recordingId = null;
    await resumeShortcuts();
  }

  function onKeyDown(e: KeyboardEvent) {
    // Esc: açık ışık detay katmanını kapat
    if (e.key === "Escape" && detailId && !recordingId) {
      detailId = null;
      return;
    }
    if (!recordingId) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      stopRecord();
      return;
    }
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    const mods: string[] = [];
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (e.metaKey) mods.push("Super");
    if (mods.length === 0 && !/^F\d{1,2}$/.test(e.code)) {
      recordMsg = tn("sc.needMod");
      return;
    }
    const keys = [...mods, e.code].join("+");
    const dup = conflictIndex(keys, recordingId);
    if (dup >= 0) {
      recordMsg = tn("sc.dup", { n: dup + 1 });
      return;
    }
    patchShortcut(recordingId, { keys });
    stopRecord();
  }

  function setTab(t: typeof tab) {
    stopRecord();
    tab = t;
  }

  function toggleSettings() {
    stopRecord();
    view = view === "settings" ? "tiles" : "settings";
    editing = false;
    picking = false;
    detailId = null;
  }

  function setSection(s: typeof section) {
    section = s;
    editing = false;
    picking = false;
    detailId = null;
  }

  function toggleDetail(entityId: string) {
    detailId = detailId === entityId ? null : entityId;
  }

  function startPick(gid: string) {
    pickGroup = gid;
    filter = "";
    domainFilter = "";
    picking = true;
  }

  const nameOf = (e: HaEntity) => e.attributes.friendly_name ?? e.entity_id;

  $: connected = $status === "connected";
  $: loaded = Object.keys($entities).length > 0;
  $: if (detailId && !$entities[detailId]) detailId = null;

  // Entity seçici: sensör sekmesinde sadece sensörler listelenir
  $: ops = section === "sensors" ? sensorOps : tileOps;
  $: used = section === "sensors" ? $usedSensors : $usedEntities;
  $: pool = Object.values($entities).filter(
    (e) => section !== "sensors" || SENSOR_DOMAINS.includes(domainOf(e.entity_id))
  );
  $: domains = [...new Set(pool.map((e) => domainOf(e.entity_id)))].sort();
  $: candidates = picking
    ? pool
        .filter((e) => !used.has(e.entity_id))
        .filter((e) => !domainFilter || domainOf(e.entity_id) === domainFilter)
        .filter((e) =>
          (nameOf(e) + " " + e.entity_id).toLowerCase().includes(filter.toLowerCase())
        )
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b), "tr"))
        .slice(0, 100)
    : [];
</script>

<svelte:window on:keydown|capture={onKeyDown} on:blur={onWindowBlur} />

<main>
  <header data-tauri-drag-region>
    <span class="dot {$status}" data-tauri-drag-region></span>
    <strong data-tauri-drag-region>HA Desk</strong>
    <span class="sp" data-tauri-drag-region></span>
    {#if view === "tiles" && connected}
      <div class="seg">
        <button class:sel={section === "tiles"} on:click={() => setSection("tiles")}>{$t("main.tiles")}</button>
        <button class:sel={section === "sensors"} on:click={() => setSection("sensors")}>{$t("main.sensors")}</button>
      </div>
      <button class="icon" class:active={editing} on:click={() => { editing = !editing; picking = false; detailId = null; }} title={$t("common.edit")}>✎</button>
    {/if}
    <button
      class="icon"
      class:active={pinned}
      on:click={togglePin}
      title={pinned ? $t("main.unpin") : $t("main.pin")}
      aria-label={$t("main.pinAria")}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill={pinned ? "currentColor" : "none"} stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
        <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" /><line x1="12" y1="14" x2="12" y2="21" />
      </svg>
    </button>
    <button class="icon" class:active={view === "settings"} on:click={toggleSettings} title={$t("main.settings")}>⚙</button>
  </header>

  <div class="body">
    {#if !ready}
      <p class="hint">{$t("common.loading")}</p>
    {:else if view === "settings"}
      <section class="settings">
        <nav class="tabs">
          <button class:sel={tab === "baglanti"} on:click={() => setTab("baglanti")}>{$t("tab.connection")}</button>
          <button class:sel={tab === "genel"} on:click={() => setTab("genel")}>{$t("tab.general")}</button>
          <button class:sel={tab === "kisayol"} on:click={() => setTab("kisayol")}>{$t("tab.shortcuts")}</button>
          <button class:sel={tab === "bildirim"} on:click={() => setTab("bildirim")}>{$t("tab.notifications")}</button>
          <button class:sel={tab === "yedek"} on:click={() => setTab("yedek")}>{$t("tab.backup")}</button>
        </nav>

        <div class="pane">
          {#if tab === "baglanti"}
            <label>{$t("conn.primary")}
              <input bind:value={primary} placeholder="http://homeassistant.local:8123" />
            </label>
            <label>{$t("conn.fallback")}
              <input bind:value={fallback} placeholder={$t("conn.fallbackPh")} />
            </label>
            <label>{$t("conn.token")}
              <input
                type="password"
                bind:value={tokenInput}
                placeholder={hasToken ? $t("conn.tokenSaved") : $t("conn.tokenPh")}
              />
            </label>
            <div class="row">
              <button class="primary" on:click={saveConnection}>{$t("conn.saveConnect")}</button>
              {#if hasToken}<button on:click={forgetToken}>{$t("conn.deleteToken")}</button>{/if}
            </div>
            <p class="state">{$t("conn.status", { status: $status })}{#if $activeUrl} · {$activeUrl}{/if}</p>
            {#if $lastError}<p class="err">{$lastError}</p>{/if}
          {:else if tab === "genel"}
            <label>{$t("general.theme")}
              <select bind:value={$settings.appearance.theme}>
                <option value="dark">{$t("theme.dark")}</option>
                <option value="light">{$t("theme.light")}</option>
                <option value="system">{$t("theme.system")}</option>
              </select>
            </label>
            <label>{$t("general.accent")}
              <input type="color" class="color" bind:value={$settings.appearance.accent} />
            </label>
            <label>{$t("general.language")}
              <select bind:value={$settings.language}>
                <option value="auto">{$t("lang.auto")}</option>
                <option value="tr">Türkçe</option>
                <option value="en">English</option>
              </select>
            </label>
            <label class="check">
              <input type="checkbox" checked={autostart} on:change={toggleAutostart} />
              {$t("general.autostart")}
            </label>
            <label class="check">
              <input type="checkbox" bind:checked={$settings.palette.sensors} />
              {$t("general.paletteSensors")}
            </label>
            {#if $lastError}<p class="err">{$lastError}</p>{/if}
          {:else if tab === "kisayol"}
            <datalist id="ent-list">
              {#each Object.values($entities) as e (e.entity_id)}
                <option value={e.entity_id}>{nameOf(e)}</option>
              {/each}
            </datalist>

            {#if $shortcuts.length === 0}
              <p class="hint">{$t("sc.none")}</p>
            {/if}

            {#each $shortcuts as s, i (s.id)}
              <div class="sc">
                <div class="row">
                  <span class="num">#{i + 1}</span>
                  <button class="keys" class:rec={recordingId === s.id} on:click={() => startRecord(s.id)}>
                    {recordingId === s.id ? $t("sc.recording") : s.keys ? prettyKeys(s.keys) : $t("sc.assign")}
                  </button>
                  <button class="icon" on:click={() => removeShortcut(s.id)} title={$t("common.delete")}>✕</button>
                </div>
                {#if recordingId === s.id && recordMsg}<p class="err">{recordMsg}</p>{/if}

                <select value={actionKind(s.action)} on:change={(e) => setKind(s.id, e.currentTarget.value as ActionKind)}>
                  {#each ACTION_OPTIONS as [k, label]}
                    <option value={k}>{$t(label)}</option>
                  {/each}
                </select>

                {#if needsEntity(s.action)}
                  <input
                    list="ent-list"
                    class:bad={entityOf(s.action) !== "" && !$entities[entityOf(s.action)]}
                    value={entityOf(s.action)}
                    placeholder={$t("common.entityPh")}
                    on:change={(e) => setEntity(s.id, e.currentTarget.value.trim())}
                  />
                {/if}

                {#if s.action.type === "adjust"}
                  <label class="inline">{$t("sc.step")}
                    <input type="number" min="1" value={stepOf(s.action)}
                      on:change={(e) => setStep(s.id, +e.currentTarget.value)} />
                  </label>
                {:else if s.action.type === "set"}
                  <label class="inline">{$t("sc.value")}
                    <input type="number" value={valueOf(s.action)}
                      on:change={(e) => setValue(s.id, +e.currentTarget.value)} />
                  </label>
                {/if}

                {#if $shortcutErrors[s.id]}<p class="err">{$t("sc.saveFail", { err: $shortcutErrors[s.id] })}</p>{/if}
              </div>
            {/each}

            <button on:click={addShortcut}>{$t("sc.add")}</button>
          {:else if tab === "bildirim"}
            <NotifyPanel />
          {:else}
            <textarea bind:value={backupText} placeholder={$t("backup.ph")}></textarea>
            <div class="row">
              <button on:click={doExport}>{$t("backup.export")}</button>
              <button on:click={doImport}>{$t("backup.import")}</button>
            </div>
            {#if backupMsg}<p class="hint">{backupMsg}</p>{/if}
          {/if}
        </div>

        <button class="primary" on:click={toggleSettings}>{$t("common.ok")}</button>
      </section>
    {:else if !connected}
      <p class="hint">
        {$status === "auth_failed" ? $t("main.tokenInvalid") : $t("main.connecting")}
        {$t("main.checkSettings")}
      </p>
      {#if $lastError}<p class="err">{$lastError}</p>{/if}
    {:else if picking}
      <div class="picker">
        <div class="prow">
          <input class="grow" placeholder={$t("common.search")} bind:value={filter} />
          <select bind:value={domainFilter}>
            <option value="">{$t("common.all")}</option>
            {#each domains as d}<option value={d}>{d}</option>{/each}
          </select>
        </div>
        <ul>
          {#each candidates as e (e.entity_id)}
            <li>
              <button on:click={() => ops.addTile(e.entity_id, pickGroup)}>
                <span class="n">{nameOf(e)}</span>
                <span class="id">{e.entity_id}</span>
              </button>
            </li>
          {/each}
        </ul>
        <button class="primary" on:click={() => (picking = false)}>{$t("common.done")}</button>
      </div>
    {:else if section === "tiles"}
      <Board
        kind="tiles"
        groupsValue={$groups}
        ops={tileOps}
        ents={$entities}
        {loaded}
        {editing}
        onPick={startPick}
        onDetail={toggleDetail}
      />
    {:else}
      <Board
        kind="sensors"
        groupsValue={$sensorGroups}
        ops={sensorOps}
        ents={$entities}
        {loaded}
        {editing}
        onPick={startPick}
      />
    {/if}
  </div>

  {#if view === "tiles" && connected && detailId && $entities[detailId]}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="backdrop" transition:fade={{ duration: 220 }} on:click|self={() => (detailId = null)}>
      <div
        class="focus"
        in:fly|global={{ y: 14, duration: 280, easing: cubicOut }}
        out:fade|global={{ duration: 120 }}
      >
        <Tile
          entityId={detailId}
          entity={$entities[detailId]}
          {loaded}
          expanded={true}
          onDetail={() => (detailId = null)}
        />
      </div>
    </div>
  {/if}
</main>

<style>
  :global(:root) {
    --bg: #1e1e1e;
    --card: #2a2a2a;
    --card-on: color-mix(in srgb, var(--accent) 18%, var(--card));
    --border: #3d3d3d;
    --text: #e6e6e6;
    --input-bg: #2b2b2b;
    --input-border: #444;
    --hover: #383838;
    --accent: #f0b429;
    color-scheme: dark;
  }
  :global(:root[data-theme="light"]) {
    --bg: #f3f3f3;
    --card: #ffffff;
    --border: #d9d9d9;
    --text: #1f1f1f;
    --input-bg: #ffffff;
    --input-border: #c8c8c8;
    --hover: #ebebeb;
    color-scheme: light;
  }
  :global(html, body) {
    margin: 0;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    color: var(--text);
    font-family: "Segoe UI", sans-serif;
  }
  :global(*) { scrollbar-width: thin; scrollbar-color: transparent transparent; }
  :global(*:hover) { scrollbar-color: #888 transparent; }

  main {
    height: 100vh;
    box-sizing: border-box;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  header { display: flex; align-items: center; gap: 8px; }
  .sp { flex: 1; align-self: stretch; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #888; }
  .dot.connected { background: #3ecf6e; }
  .dot.connecting { background: #f0b429; }
  .dot.auth_failed { background: #e5484d; }

  .seg { display: flex; gap: 2px; padding: 2px; background: var(--card); border-radius: 9px; }
  .seg button {
    border: none;
    background: transparent;
    padding: 4px 9px;
    font-size: 12px;
    border-radius: 7px;
  }
  .seg button.sel { background: var(--accent); color: #1a1a1a; font-weight: 600; }

  .body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 6px 4px 6px 0; }

  /* ışık detayı: bulanık arkaplan üstünde odaklanmış kutucuk */
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
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  }

  input, select, button, textarea {
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: inherit;
    font-size: 13px;
    font-family: inherit;
  }
  button { cursor: pointer; }
  button:hover { background: var(--hover); }
  .icon { padding: 3px 9px; font-size: 14px; display: inline-flex; align-items: center; justify-content: center; }
  .icon.active { border-color: var(--accent); color: var(--accent); }
  .primary { background: var(--accent); color: #1a1a1a; border-color: var(--accent); font-weight: 600; }
  .primary:hover { background: var(--accent); filter: brightness(1.1); }
  .seg button:hover { background: transparent; }
  .seg button.sel:hover { background: var(--accent); }
  .hint { opacity: 0.65; font-size: 13px; }
  .err { color: #e5484d; font-size: 12px; margin: 0; }

  .settings { display: flex; flex-direction: column; gap: 10px; height: 100%; }
  .tabs { display: flex; gap: 4px; padding: 3px; background: var(--card); border-radius: 10px; }
  .tabs button { flex: 1; border: none; background: transparent; padding: 6px 2px; border-radius: 8px; font-size: 12px; }
  .tabs button.sel { background: var(--accent); color: #1a1a1a; font-weight: 600; }
  .pane { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
  .pane label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  .pane textarea { flex: 1; resize: none; font-family: Consolas, monospace; font-size: 11px; }
  .check { flex-direction: row !important; align-items: center; gap: 8px !important; }
  .check input { padding: 0; }
  .color { padding: 2px; height: 34px; }
  .row { display: flex; gap: 8px; }
  .state { font-size: 12px; opacity: 0.7; margin: 0; word-break: break-all; }

  .sc {
    display: flex; flex-direction: column; gap: 6px;
    padding: 8px; background: var(--card); border: 1px solid var(--border); border-radius: 10px;
  }
  .num { align-self: center; font-size: 12px; opacity: 0.6; }
  .keys { flex: 1; text-align: left; font-family: Consolas, monospace; }
  .keys.rec { border-color: var(--accent); color: var(--accent); }
  .sc .inline { flex-direction: row; align-items: center; gap: 8px; }
  .sc .inline input { width: 80px; }
  .bad { border-color: #e5484d !important; }

  .picker { display: flex; flex-direction: column; gap: 8px; height: 100%; }
  .prow { display: flex; gap: 6px; }
  .grow { flex: 1; min-width: 0; }
  .picker ul {
    list-style: none; padding: 0; margin: 0;
    flex: 1; min-height: 0; overflow-y: auto;
    display: flex; flex-direction: column; gap: 4px;
  }
  .picker li button {
    width: 100%; text-align: left;
    display: flex; flex-direction: column; gap: 1px;
  }
  .n { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .id { font-size: 10px; opacity: 0.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
