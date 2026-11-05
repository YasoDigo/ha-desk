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
  import Icon from "$lib/Icon.svelte";
  import "$lib/theme.css";
  import { startNotifications } from "$lib/notify";
  import { t, tn } from "$lib/i18n";
  import { startMobile } from "$lib/mobile";
  import { areas, entityArea } from "$lib/areas";

  // hazır vurgu renkleri (ilki varsayılan gümüş-gri)
  const ACCENTS = ["#a8adb7", "#d4a373", "#7fb7a4", "#c08497", "#8fa3c7", "#e0b84c"];

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
  let areaFilter = ""; // "" = tüm odalar, "__none" = odası olmayanlar, diğerleri oda kimliği

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

  // Alt çubuktan bölüm seç: ayarlardaysak önce kutucuklara döner
  function goSection(s: typeof section) {
    stopRecord();
    view = "tiles";
    setSection(s);
  }

  function toggleEdit() {
    if (view !== "tiles" || !connected) return;
    editing = !editing;
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
    areaFilter = "";
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
  $: filtered = picking
    ? pool
        .filter((e) => !used.has(e.entity_id))
        .filter((e) => !domainFilter || domainOf(e.entity_id) === domainFilter)
        .filter((e) =>
          areaFilter === ""
            ? true
            : areaFilter === "__none"
              ? !$entityArea[e.entity_id]
              : $entityArea[e.entity_id] === areaFilter
        )
        .filter((e) =>
          (nameOf(e) + " " + e.entity_id).toLowerCase().includes(filter.toLowerCase())
        )
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b), "tr"))
    : [];
  $: candidates = filtered.slice(0, 100);

  // "Odadakileri ekle": kutucuklarda sadece kumanda edilebilen türler, sensörlerde hepsi
  const BULK = new Set([
    "light", "switch", "fan", "cover", "lock", "climate", "media_player", "scene", "script",
    "input_boolean", "number", "input_number", "select", "input_select", "button", "input_button",
  ]);
  $: roomBulk =
    areaFilter && areaFilter !== "__none"
      ? filtered.filter((e) => section === "sensors" || BULK.has(domainOf(e.entity_id)))
      : [];

  function addRoom() {
    const list = section === "sensors" ? $sensorGroups : $groups;
    const grp = list.find((g) => g.id === pickGroup);
    const room = $areas.find((a) => a.id === areaFilter);
    if (grp && !grp.title && room) ops.renameGroup(pickGroup, room.name);
    for (const e of roomBulk) ops.addTile(e.entity_id, pickGroup);
  }
</script>

<svelte:window on:keydown|capture={onKeyDown} on:blur={onWindowBlur} />

<main>
  <header data-tauri-drag-region>
    <span class="dot {$status}" data-tauri-drag-region></span>
    <strong data-tauri-drag-region>HA Desk</strong>
    <span class="sp" data-tauri-drag-region></span>
    {#if view === "tiles" && connected}
      <button class="ghost" class:active={editing} on:click={toggleEdit} title={$t("common.edit")} aria-label={$t("common.edit")}>
        <Icon name="pencil" size={16} />
      </button>
    {/if}
    <button
      class="ghost"
      class:active={pinned}
      on:click={togglePin}
      title={pinned ? $t("main.unpin") : $t("main.pin")}
      aria-label={$t("main.pinAria")}
    >
      <Icon name="pin" size={16} fill={pinned ? "currentColor" : "none"} />
    </button>
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
            <div class="card">
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
            </div>
            <p class="state">{$t("conn.status", { status: $t(`status.${$status}`) })}{#if $activeUrl}&nbsp;·&nbsp;{$activeUrl}{/if}</p>
            {#if $lastError}<p class="err">{$lastError}</p>{/if}
          {:else if tab === "genel"}
            <div class="card">
              <label>{$t("general.theme")}
                <select bind:value={$settings.appearance.theme}>
                  <option value="dark">{$t("theme.dark")}</option>
                  <option value="light">{$t("theme.light")}</option>
                  <option value="system">{$t("theme.system")}</option>
                </select>
              </label>
              <div class="fld">
                <span class="fl">{$t("general.accent")}</span>
                <div class="swatches">
                  {#each ACCENTS as c}
                    <button
                      class="sw"
                      class:cur={$settings.appearance.accent.toLowerCase() === c}
                      style="background:{c}"
                      title={c}
                      aria-label={c}
                      on:click={() => ($settings.appearance.accent = c)}
                    ></button>
                  {/each}
                  <label class="sw custom" class:cur={!ACCENTS.includes($settings.appearance.accent.toLowerCase())} title="#rrggbb">
                    <input type="color" bind:value={$settings.appearance.accent} />
                  </label>
                </div>
              </div>
              <label>{$t("general.language")}
                <select bind:value={$settings.language}>
                  <option value="auto">{$t("lang.auto")}</option>
                  <option value="tr">Türkçe</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
            <div class="card">
              <label class="check">
                <input type="checkbox" checked={autostart} on:change={toggleAutostart} />
                {$t("general.autostart")}
              </label>
              <label class="check">
                <input type="checkbox" bind:checked={$settings.palette.sensors} />
                {$t("general.paletteSensors")}
              </label>
            </div>
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
                  <button class="icon" on:click={() => removeShortcut(s.id)} title={$t("common.delete")}><Icon name="close" size={14} /></button>
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
            <div class="card grow-card">
              <textarea bind:value={backupText} placeholder={$t("backup.ph")}></textarea>
              <div class="row">
                <button on:click={doExport}>{$t("backup.export")}</button>
                <button on:click={doImport}>{$t("backup.import")}</button>
              </div>
            </div>
            {#if backupMsg}<p class="hint">{backupMsg}</p>{/if}
          {/if}
        </div>

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
        {#if $areas.length}
          <div class="prow">
            <select class="grow" bind:value={areaFilter}>
              <option value="">{$t("area.all")}</option>
              {#each $areas as a}<option value={a.id}>{a.name}</option>{/each}
              <option value="__none">{$t("area.none")}</option>
            </select>
            {#if roomBulk.length}
              <button on:click={addRoom}>{$t("area.addAll", { n: roomBulk.length })}</button>
            {/if}
          </div>
        {/if}
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

  <nav class="dock" aria-label={$t("main.pinAria")}>
    <button class:sel={view === "tiles" && section === "tiles"} disabled={!connected} on:click={() => goSection("tiles")}>
      <Icon name="grid" size={19} /><span>{$t("main.tiles")}</span>
    </button>
    <button class:sel={view === "tiles" && section === "sensors"} disabled={!connected} on:click={() => goSection("sensors")}>
      <Icon name="gauge" size={19} /><span>{$t("main.sensors")}</span>
    </button>
    <button class:sel={view === "settings"} on:click={toggleSettings}>
      <Icon name="gear" size={19} /><span>{$t("main.settings")}</span>
    </button>
  </nav>

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
  main {
    height: 100vh;
    box-sizing: border-box;
    padding: 10px 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  header { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 2px; }
  header strong { font-family: var(--font-display); font-size: 14px; font-weight: 600; letter-spacing: 0.01em; }
  .sp { flex: 1; align-self: stretch; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
  .dot.connected { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent); }
  .dot.connecting { background: var(--accent); }
  .dot.auth_failed { background: var(--danger); }

  .ghost { padding: 5px 7px; background: transparent; display: inline-flex; color: var(--muted); border-radius: 999px; }
  .ghost:hover:not(:disabled) { background: var(--plate); color: var(--text); }
  .ghost.active { color: var(--accent-text); background: color-mix(in srgb, var(--accent) 20%, var(--plate)); }

  .body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; padding: 4px 0 8px; }

  /* alt çubuk: bölümler arasında geçiş */
  .dock {
    display: flex;
    gap: 2px;
    padding: 4px;
    background: var(--plate);
    border-radius: 999px;
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 7%, transparent);
  }
  .dock button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 6px 0 5px;
    font-size: 10.5px;
    color: var(--muted);
    background: transparent;
    border-radius: 999px;
  }
  .dock button:hover:not(:disabled) { background: var(--raised); color: var(--text); }
  .dock button.sel { background: color-mix(in srgb, var(--accent) 22%, var(--plate)); color: var(--accent-text); font-weight: 600; }
  .dock button.sel:hover { background: color-mix(in srgb, var(--accent) 22%, var(--plate)); color: var(--accent-text); }
  .dock button:disabled { opacity: 0.35; }

  /* ışık detayı: bulanık arkaplan üstünde odaklanmış kutucuk */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 48px 12px 12px;
    overflow-y: auto;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(10px);
  }
  .focus { width: 100%; border-radius: var(--r-tile); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4); }

  .hint { color: var(--muted); font-size: 13px; }
  .err { color: var(--danger); font-size: 12px; margin: 0; }

  .settings { display: flex; flex-direction: column; gap: 10px; height: 100%; }
  .tabs { display: flex; gap: 2px; padding: 3px; background: var(--plate); border-radius: 999px; }
  .tabs button { flex: 1; background: transparent; padding: 6px 2px; border-radius: 999px; font-size: 12px; color: var(--muted); }
  .tabs button:hover:not(:disabled) { background: var(--raised); color: var(--text); }
  .tabs button.sel { background: color-mix(in srgb, var(--accent) 22%, var(--plate)); color: var(--accent-text); font-weight: 600; }
  .pane { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding-right: 2px; }
  .pane label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--muted); }
  .pane label > :global(input), .pane label > :global(select) { color: var(--text); }
  .pane textarea { flex: 1; resize: none; font-family: Consolas, monospace; font-size: 11px; }
  .check { flex-direction: row !important; align-items: center; gap: 8px !important; color: var(--text) !important; }
  .check input { padding: 0; }
  .color { padding: 2px; height: 34px; }
  .card { display: flex; flex-direction: column; gap: 12px; padding: 14px; background: var(--plate); border-radius: 18px; }
  .grow-card { flex: 1; min-height: 0; }
  .fld { display: flex; flex-direction: column; gap: 8px; }
  .fl { font-size: 12px; color: var(--muted); }
  .swatches { display: flex; gap: 10px; align-items: center; }
  .sw { position: relative; width: 26px; height: 26px; padding: 0; border-radius: 50%; border: 0; flex: none; }
  .sw.cur { box-shadow: 0 0 0 2px var(--plate), 0 0 0 4px var(--text); }
  .sw.custom { cursor: pointer; background: conic-gradient(#e5736f, #e8c35c, #6fcf97, #5cb7e8, #a78bfa, #e5736f); }
  .sw.custom input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; padding: 0; }
  .row { display: flex; gap: 8px; }
  .state { font-size: 12px; color: var(--muted); margin: 0; word-break: break-all; }

  .sc .icon { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; }
  .sc {
    display: flex; flex-direction: column; gap: 6px;
    padding: 10px; background: var(--plate); border-radius: 16px;
  }
  .num { align-self: center; font-size: 12px; color: var(--muted); }
  .keys { flex: 1; text-align: left; font-family: Consolas, monospace; }
  .keys.rec { box-shadow: inset 0 0 0 1.5px var(--accent); color: var(--accent-text); }
  .sc .inline { flex-direction: row; align-items: center; gap: 8px; }
  .sc .inline input { width: 80px; }
  .bad { box-shadow: inset 0 0 0 1.5px var(--danger) !important; }

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
    background: var(--plate);
    border-radius: 12px;
  }
  .picker li button:hover { background: var(--raised); }
  .n { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .id { font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
