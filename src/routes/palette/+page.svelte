<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { invoke } from "@tauri-apps/api/core";
  import { ha, status, entities } from "$lib/ha";
  import type { HaEntity } from "$lib/ha";
  import { domainOf, kindOf, hasDetail, press, hvacLabel, stateText } from "$lib/tileKind";
  import { settings } from "$lib/config";
  import { areaNames } from "$lib/areas";
  import { askAssist } from "$lib/assist";
  import { t, tn } from "$lib/i18n";
  import type { Key, TFn } from "$lib/i18n";
  import Tile from "$lib/Tile.svelte";
  import SensorDetail from "$lib/SensorDetail.svelte";

  // Palette gelen varlık türleri (ileride buraya yenisi eklemek yeterli)
  const DOMAINS: Record<string, { label: Key; icon: string }> = {
    light: { label: "dom.light", icon: "💡" },
    switch: { label: "dom.switch", icon: "🔌" },
    scene: { label: "dom.scene", icon: "🎬" },
    script: { label: "dom.script", icon: "📜" },
    automation: { label: "dom.automation", icon: "⚙️" },
    input_boolean: { label: "dom.input_boolean", icon: "🔘" },
    button: { label: "dom.button", icon: "🔲" },
    input_button: { label: "dom.button", icon: "🔲" },
    fan: { label: "dom.fan", icon: "🌀" },
    cover: { label: "dom.cover", icon: "🪟" },
    lock: { label: "dom.lock", icon: "🔒" },
    climate: { label: "dom.climate", icon: "🌡️" },
    media_player: { label: "dom.media", icon: "🎵" },
    number: { label: "dom.number", icon: "🎚️" },
    input_number: { label: "dom.number", icon: "🎚️" },
    select: { label: "dom.select", icon: "📋" },
    input_select: { label: "dom.select", icon: "📋" },
  };
  // Sadece ayarlarda "sensörleri de ara" açıksa ve bir şey yazılmışsa aranır
  const SENSOR_DOMAINS: Record<string, { label: Key; icon: string }> = {
    sensor: { label: "dom.sensor", icon: "🌡️" },
    binary_sensor: { label: "dom.binary", icon: "📡" },
  };
  const META = { ...DOMAINS, ...SENSOR_DOMAINS };
  // Enter'a basınca "çalıştır" olan türler (diğerleri aç/kapat yapılır)
  const BUTTONY = new Set(["scene", "script", "automation", "button", "input_button"]);
  // Enter'a basınca doğrudan ayrıntı paneli açılan türler (kilit gibi tek tıkla yapılmaması gerekenler)
  const DETAIL_ONLY = new Set(["number", "select", "lock", "climate", "media"]);
  const RECENT_KEY = "ha_desk_palette_recent";

  type Item = {
    e: HaEntity;
    name: string;
    fname: string;
    hay: string;
    area: string;
    meta: { label: string; icon: string };
  };

  let query = "";
  let sel = 0;
  let input: HTMLInputElement;
  let listEl: HTMLDivElement;
  let note = "";
  let connKey = "";
  let recent: string[] = [];
  let detailId: string | null = null; // ayrıntı panelinde açık olan varlık
  let showMore = true; // ışıkta renk/efekt bölümü açık mı
  let withSensors = false; // ayarlardan gelir

  // Türkçe harfleri ve büyük/küçük farkını yok sayarak karşılaştırma
  const fold = (s: string) =>
    s
      .toLocaleLowerCase("tr")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i");

  function loadRecent(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 20) : [];
    } catch {
      return [];
    }
  }

  function remember(id: string) {
    recent = [id, ...recent.filter((x) => x !== id)].slice(0, 20);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {}
  }

  function rank(it: Item, r: string[]) {
    const i = r.indexOf(it.e.entity_id);
    return i < 0 ? 999 : i;
  }

  function score(it: Item, tokens: string[]): number {
    let s = 0;
    for (const t of tokens) {
      if (!it.hay.includes(t)) return -1;
      if (it.fname.startsWith(t)) s += 4;
      else if (it.fname.split(/[\s_.-]+/).some((w) => w.startsWith(t))) s += 3;
      else if (it.fname.includes(t)) s += 2;
    }
    return s;
  }

  function toItem(e: HaEntity, tf: TFn, areas: Record<string, string>): Item {
    const name = String(e.attributes.friendly_name ?? e.entity_id);
    const m = META[domainOf(e.entity_id)];
    const meta = { icon: m.icon, label: tf(m.label) };
    const area = areas[e.entity_id] ?? "";
    return { e, name, fname: fold(name), hay: fold(`${name} ${e.entity_id} ${meta.label} ${area}`), area, meta };
  }

  $: items = Object.values($entities)
    .filter((e) => DOMAINS[domainOf(e.entity_id)])
    .map((e) => toItem(e, $t, $areaNames));

  $: sensorItems = withSensors
    ? Object.values($entities)
        .filter((e) => SENSOR_DOMAINS[domainOf(e.entity_id)])
        .map((e) => toItem(e, $t, $areaNames))
    : [];

  $: tokens = fold(query).split(/\s+/).filter(Boolean);

  // Sensörler listeyi kalabalıklaştırmasın diye sadece arama yapılırken eklenir
  $: pool = tokens.length ? [...items, ...sensorItems] : items;

  $: results = (
    tokens.length
      ? pool.map((it) => ({ it, s: score(it, tokens) })).filter((x) => x.s >= 0)
      : pool.map((it) => ({ it, s: 0 }))
  )
    .sort(
      (a, b) =>
        b.s - a.s ||
        rank(a.it, recent) - rank(b.it, recent) ||
        a.it.name.localeCompare(b.it.name, "tr")
    )
    .slice(0, 60)
    .map((x) => x.it);

  $: if (sel >= results.length) sel = Math.max(0, results.length - 1);

  // Hiçbir şey bulunamazsa yazılan metin Assist'e sorulabilir ("?" ile başlayan metin her zaman Assist'e gider)
  $: assistText = results.length === 0 ? query.replace(/^\?\s*/, "").trim() : "";
  let assistView = false;
  let assistBusy = false;
  let assistAsked = "";
  let assistReply = "";
  let assistErr = "";

  async function ask(text: string) {
    text = text.trim();
    if (!text || assistBusy) return;
    if ($status !== "connected") {
      note = tn("pal.notConnected");
      return;
    }
    assistView = true;
    assistBusy = true;
    assistAsked = text;
    assistReply = "";
    assistErr = "";
    try {
      assistReply = (await askAssist(text)) || tn("pal.assistEmpty");
    } catch (e) {
      assistErr = tn("pal.assistFail", { err: e instanceof Error ? e.message : String(e) });
    }
    assistBusy = false;
    await tick();
    input?.select(); // devam sorusu için metin seçili kalır
  }

  $: dEntity = detailId ? $entities[detailId] : undefined;
  $: dm = detailId ? META[domainOf(detailId)] : undefined;
  $: dMeta = dm ? { icon: dm.icon, label: $t(dm.label) } : undefined;
  $: dIsSensor = detailId ? !!SENSOR_DOMAINS[domainOf(detailId)] : false;

  const isSensorDomain = (e: HaEntity) => !!SENSOR_DOMAINS[domainOf(e.entity_id)];
  // Grafiği olan sensör: sayısal değeri olanlar
  const isNumeric = (e: HaEntity) => e.state.trim() !== "" && Number.isFinite(Number(e.state));

  // Ayrıntı paneli olan türler: parlaklık/renk, kaydırıcı, seçim listesi, sayısal sensör grafiği
  function hasMore(e: HaEntity): boolean {
    if (isSensorDomain(e)) return domainOf(e.entity_id) === "sensor" && isNumeric(e);
    const k = kindOf(e);
    return k === "dimmer" || DETAIL_ONLY.has(k) || k === "cover" || hasDetail(e);
  }

  function stateLabel(it: Item, tf: TFn): string {
    const { state } = it.e;
    const d = domainOf(it.e.entity_id);
    if (state === "unavailable") return tf("pal.na");
    if (d === "automation") return state === "on" ? tf("pal.enabled") : tf("pal.disabled");
    if (BUTTONY.has(d)) return "";
    if (d === "binary_sensor") return state === "on" ? tf("pal.active") : state === "off" ? tf("pal.inactive") : state;
    if (d === "lock" || d === "cover" || d === "media_player") return stateText(state, tf);
    if (d === "climate") return state === "off" ? tf("state.off") : hvacLabel(state, tf);
    if (state === "on") return tf("state.on");
    if (state === "off") return tf("state.off");
    const unit = it.e.attributes.unit_of_measurement;
    return unit ? `${state} ${unit}` : state;
  }

  function activate(e: HaEntity, alt = false) {
    if ($status !== "connected") {
      note = tn("pal.notConnected");
      return;
    }
    const id = e.entity_id;
    const d = domainOf(id);
    // Sensörler salt okunur: sayısal olanın grafiği açılır
    if (isSensorDomain(e)) {
      if (hasMore(e)) openDetail(e);
      else note = tn("pal.readOnly");
      return;
    }
    remember(id);
    // Sayı, seçim, kilit, klima ve medyada tek tıkla aç/kapat uygun değil: ayrıntı paneli açılır
    const k = kindOf(e);
    if (DETAIL_ONLY.has(k)) {
      openDetail(e);
      return;
    }
    // Shift+Enter: otomasyonu tetiklemek yerine etkin/devre dışı yapar
    const call =
      BUTTONY.has(d) && !(alt && d === "automation")
        ? press(e)
        : ha.callService("homeassistant", "toggle", id);
    call.catch((err) => console.error("Palet hatası", err));
    close();
  }

  function close() {
    invoke("hide_palette").catch(() => {});
  }

  function openDetail(e: HaEntity) {
    if (!hasMore(e)) return;
    remember(e.entity_id);
    detailId = e.entity_id;
    showMore = true;
    input?.blur(); // arka plandaki arama kutusu tuşları yutmasın
  }

  async function closeDetail() {
    detailId = null;
    await tick();
    input?.focus();
  }

  function pick(e: HaEntity, option: string) {
    ha.callService(domainOf(e.entity_id), "select_option", e.entity_id, { option }).catch((err) =>
      console.error("Palet hatası", err)
    );
  }

  async function reveal() {
    await tick();
    listEl?.querySelector(".row.sel")?.scrollIntoView({ block: "nearest" });
  }

  function onKey(ev: KeyboardEvent) {
    if (assistView) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        assistView = false;
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        ask(query.replace(/^\?\s*/, ""));
      }
      return;
    }
    if (detailId) return;
    const n = results.length;
    if (ev.key === "ArrowDown" || (ev.key === "Tab" && !ev.shiftKey)) {
      ev.preventDefault();
      sel = n ? (sel + 1) % n : 0;
      reveal();
    } else if (ev.key === "ArrowUp" || (ev.key === "Tab" && ev.shiftKey)) {
      ev.preventDefault();
      sel = n ? (sel - 1 + n) % n : 0;
      reveal();
    } else if (ev.key === "Enter" && ev.ctrlKey) {
      // Ctrl+Enter: ayrıntı paneli
      ev.preventDefault();
      const it = results[sel];
      if (it) openDetail(it.e);
    } else if (
      ev.key === "ArrowRight" &&
      input.selectionStart === input.value.length &&
      input.selectionEnd === input.value.length
    ) {
      // Yazı sonunda sağ ok: ayrıntı paneli (ortadaysa normal imleç hareketi)
      const it = results[sel];
      if (it && hasMore(it.e)) {
        ev.preventDefault();
        openDetail(it.e);
      }
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const it = results[sel];
      if (it) activate(it.e, ev.shiftKey);
      else if (assistText) ask(assistText);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  }

  function applyTheme(a: any) {
    const theme = a?.theme === "light" || a?.theme === "system" ? a.theme : "dark";
    const dark =
      theme === "dark" ||
      (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    if (typeof a?.accent === "string" && /^#[0-9a-f]{6}$/i.test(a.accent)) {
      document.documentElement.style.setProperty("--accent", a.accent);
    }
  }

  // Ayarlar ana pencerede değişmiş olabilir: her açılışta dosyayı okuyup gerekirse yeniden bağlanır
  async function ensureConnected() {
    try {
      const text = (await invoke("load_config")) as string | null;
      const raw = text ? JSON.parse(text) : {};
      applyTheme(raw.appearance);
      withSensors = raw.palette?.sensors === true;
      // Dil ana pencerede değişmiş olabilir
      const lg = ["auto", "tr", "en"].includes(raw.language) ? raw.language : "auto";
      settings.update((s) => (s.language === lg ? s : { ...s, language: lg }));
      const c = raw.connection ?? {};
      const urls = [c.primaryUrl, c.fallbackUrl].filter(
        (u) => typeof u === "string" && u.trim()
      ) as string[];
      const token = (await invoke("get_token")) as string | null;
      if (!token || urls.length === 0) {
        note = tn("pal.setupFirst");
        return;
      }
      const key = JSON.stringify([urls, token]);
      if (key !== connKey || $status === "auth_failed") {
        connKey = key;
        ha.connect(urls, token);
      }
    } catch (e) {
      note = String(e);
    }
  }

  // Ayrıntı panelinde Esc listeye döner (kaydırıcılar oklarla oynandığı için sadece Esc)
  function onWinKey(ev: KeyboardEvent) {
    if (detailId && ev.key === "Escape") {
      ev.preventDefault();
      closeDetail();
    }
  }

  // Alt satırdaki ipucu seçili öğeye göre değişir
  function hintFor(it: Item | undefined, tf: TFn): string {
    const esc = tf("hint.esc");
    const join = (...p: string[]) => [...p, esc].join(" · ");
    if (!it) return esc;
    const d = domainOf(it.e.entity_id);
    const k = kindOf(it.e);
    if (isSensorDomain(it.e)) return join(hasMore(it.e) ? tf("hint.chart") : tf("hint.readonly"));
    if (DETAIL_ONLY.has(k)) return join(tf("hint.detail"));
    if (k === "cover") return join(tf("hint.toggle"), tf("hint.more"));
    if (d === "automation") return join(tf("hint.trigger"), tf("hint.autoSwitch"));
    if (BUTTONY.has(d)) return join(tf("hint.run"));
    return join(tf("hint.toggle"), ...(hasMore(it.e) ? [tf("hint.more")] : []));
  }

  async function onShow() {
    query = "";
    sel = 0;
    note = "";
    detailId = null;
    assistView = false;
    recent = loadRecent();
    await tick();
    if (listEl) listEl.scrollTop = 0;
    input?.focus();
    input?.select();
    ensureConnected();
  }

  onMount(() => {
    recent = loadRecent();
    ensureConnected();
    const vis = () => {
      if (document.visibilityState === "visible") onShow();
    };
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("focus", onShow);
      document.removeEventListener("visibilitychange", vis);
    };
  });
</script>

<svelte:window on:keydown={onWinKey} />

<div class="shell">
  <div class="search">
    <span class="mag">⌕</span>
    <input
      bind:this={input}
      bind:value={query}
      on:keydown={onKey}
      on:input={() => (note = "")}
      placeholder={$t("pal.placeholder")}
      spellcheck="false"
      autocomplete="off"
    />
  </div>

  {#if assistView}
    <div class="assist">
      <div class="aq">{assistAsked}</div>
      {#if assistBusy}
        <div class="abusy"><span class="spin"></span>{$t("pal.assistBusy")}</div>
      {:else if assistErr}
        <div class="aerr">{assistErr}</div>
      {:else}
        <div class="areply">{assistReply}</div>
      {/if}
    </div>
  {:else}
  <div class="list" bind:this={listEl}>
    {#each results as it, i (it.e.entity_id)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="row"
        class:sel={i === sel}
        on:mousemove={() => (sel = i)}
        on:click={(ev) => activate(it.e, ev.shiftKey)}
      >
        <span class="ico">{it.meta.icon}</span>
        <span class="txt">
          <span class="name">{it.name}</span>
          <span class="id">{it.e.entity_id}{it.area ? " · " + it.area : ""}</span>
        </span>
        {#if stateLabel(it, $t)}
          <span class="pill" class:on={it.e.state === "on"}>{stateLabel(it, $t)}</span>
        {/if}
        <span class="dom">{it.meta.label}</span>
        {#if hasMore(it.e)}
          <button class="more" title={$t("pal.detail")} on:click|stopPropagation={() => openDetail(it.e)}>›</button>
        {/if}
      </div>
    {:else}
      <div class="empty">
        {#if $status !== "connected"}
          {$t("main.connecting")}
        {:else if query}
          {$t("pal.noResults")}
        {:else}
          {$t("pal.noEntities")}
        {/if}
      </div>
    {/each}
    {#if assistText && $status === "connected"}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="row sel" on:click={() => ask(assistText)}>
        <span class="ico">✨</span>
        <span class="txt"><span class="name">{$t("pal.assistAsk", { q: assistText })}</span></span>
      </div>
    {/if}
  </div>
  {/if}

  {#if detailId}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="backdrop" transition:fade={{ duration: 200 }} on:click|self={closeDetail}>
      <div
        class="focus"
        in:fly|global={{ y: 14, duration: 260, easing: cubicOut }}
        out:fade|global={{ duration: 120 }}
      >
        <div class="bar">
          <span class="dtype">{dMeta?.icon} {dMeta?.label}</span>
          <button class="x" title={$t("pal.closeEsc")} on:click={closeDetail}>✕</button>
        </div>
        {#if !dEntity}
          <div class="empty">{$t("pal.noEntities")}</div>
        {:else if dIsSensor}
          <SensorDetail entityId={detailId} entity={dEntity} onClose={closeDetail} />
        {:else if kindOf(dEntity) === "select"}
          <div class="opts">
            <div class="oname">{dEntity.attributes.friendly_name ?? dEntity.entity_id}</div>
            {#each dEntity.attributes.options ?? [] as o}
              <button class="opt" class:cur={o === dEntity.state} on:click={() => pick(dEntity, o)}>
                {o}
              </button>
            {/each}
          </div>
        {:else}
          <Tile
            entityId={detailId}
            entity={dEntity}
            loaded={true}
            expanded={showMore}
            onDetail={() => (showMore = !showMore)}
          />
        {/if}
      </div>
    </div>
  {/if}

  <div class="foot">
    {#if note}
      <span class="warn">{note}</span>
    {:else if assistView}
      <span>{$t("hint.assistAgain")}</span>
    {:else if detailId}
      <span>{$t("pal.back")}</span>
    {:else if assistText && results.length === 0}
      <span>{$t("hint.assist")} · {$t("hint.esc")}</span>
    {:else}
      <span>{$t("pal.select")} · {hintFor(results[sel], $t)}</span>
    {/if}
    <span>{$status === "connected" ? (detailId ? $t("pal.live") : $t("pal.results", { n: results.length })) : $t("pal.offline")}</span>
  </div>
</div>

<style>
  :global(:root) {
    --bg: #1e1e1e;
    --card: #2a2a2a;
    --border: #3d3d3d;
    --text: #e6e6e6;
    --muted: #8d8d8d;
    --hover: #383838;
    --accent: #f0b429;
    --card-on: color-mix(in srgb, var(--accent) 18%, var(--card));
    --input-bg: #2b2b2b;
    --input-border: #444;
    color-scheme: dark;
  }
  :global(:root[data-theme="light"]) {
    --bg: #f6f6f6;
    --card: #ffffff;
    --border: #d9d9d9;
    --text: #1f1f1f;
    --muted: #707070;
    --hover: #e9e9e9;
    --input-bg: #ffffff;
    --input-border: #c8c8c8;
    color-scheme: light;
  }
  :global(html, body) {
    margin: 0;
    height: 100%;
    overflow: hidden;
    background: transparent;
    color: var(--text);
    font-family: "Segoe UI", sans-serif;
  }
  :global(*) { scrollbar-width: thin; scrollbar-color: transparent transparent; }
  :global(*:hover) { scrollbar-color: #888 transparent; }

  .shell {
    position: relative;
    height: 100vh;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 14px;
    overflow: hidden;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }
  .mag { font-size: 20px; color: var(--muted); }
  input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-size: 18px;
    font-family: inherit;
  }
  input::placeholder { color: var(--muted); }

  .list { flex: 1; overflow-y: auto; padding: 6px; }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 9px;
    cursor: pointer;
    user-select: none;
  }
  .row.sel {
    background: color-mix(in srgb, var(--accent) 16%, var(--card));
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .ico { width: 26px; text-align: center; font-size: 18px; }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .id { font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill {
    font-size: 11.5px;
    padding: 2px 8px;
    border-radius: 20px;
    background: var(--card);
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .pill.on { color: var(--accent); border-color: var(--accent); }
  .dom { font-size: 11.5px; color: var(--muted); min-width: 64px; text-align: right; }

  .assist { flex: 1; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 10px; }
  .aq { font-size: 12.5px; color: var(--muted); }
  .areply { font-size: 15.5px; line-height: 1.45; white-space: pre-wrap; }
  .aerr { font-size: 13.5px; color: #e5484d; }
  .abusy { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--muted); }
  .spin {
    width: 14px; height: 14px; border-radius: 50%;
    border: 2px solid var(--border); border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .more {
    background: transparent;
    border: none;
    color: var(--muted);
    font-size: 20px;
    line-height: 1;
    padding: 0 6px;
    cursor: pointer;
  }
  .more:hover { color: var(--accent); }

  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    padding: 14px 18px;
    overflow-y: auto;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(8px);
  }
  .focus {
    width: 100%;
    max-width: 440px;
    margin: auto;
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  }
  .bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .dtype { font-size: 12.5px; color: var(--muted); }
  .x {
    padding: 2px 9px;
    font-size: 13px;
    color: var(--text);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
  }
  .x:hover { background: var(--hover); }

  .opts {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 12px;
  }
  .oname { font-weight: 600; margin-bottom: 4px; }
  .opt {
    text-align: left;
    padding: 8px 12px;
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 9px;
    cursor: pointer;
  }
  .opt:hover { background: var(--hover); }
  .opt.cur { border-color: var(--accent); color: var(--accent); }

  .empty { padding: 40px 0; text-align: center; color: var(--muted); }
  .foot {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    font-size: 11.5px;
    color: var(--muted);
  }
  .warn { color: var(--accent); }
</style>
