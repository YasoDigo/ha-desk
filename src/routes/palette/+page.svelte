<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { invoke } from "@tauri-apps/api/core";
  import { ha, status, entities } from "$lib/ha";
  import type { HaEntity } from "$lib/ha";
  import { domainOf, kindOf, hasDetail, press, HVAC_TR } from "$lib/tileKind";
  import Tile from "$lib/Tile.svelte";
  import SensorDetail from "$lib/SensorDetail.svelte";

  // Palette gelen varlık türleri (ileride buraya yenisi eklemek yeterli)
  const DOMAINS: Record<string, { label: string; icon: string }> = {
    light: { label: "Işık", icon: "💡" },
    switch: { label: "Anahtar", icon: "🔌" },
    scene: { label: "Sahne", icon: "🎬" },
    script: { label: "Script", icon: "📜" },
    automation: { label: "Otomasyon", icon: "⚙️" },
    input_boolean: { label: "Düğme", icon: "🔘" },
    button: { label: "Buton", icon: "🔲" },
    input_button: { label: "Buton", icon: "🔲" },
    fan: { label: "Fan", icon: "🌀" },
    cover: { label: "Perde", icon: "🪟" },
    lock: { label: "Kilit", icon: "🔒" },
    climate: { label: "Klima", icon: "🌡️" },
    media_player: { label: "Medya", icon: "🎵" },
    number: { label: "Sayı", icon: "🎚️" },
    input_number: { label: "Sayı", icon: "🎚️" },
    select: { label: "Seçim", icon: "📋" },
    input_select: { label: "Seçim", icon: "📋" },
  };
  // Sadece ayarlarda "sensörleri de ara" açıksa ve bir şey yazılmışsa aranır
  const SENSOR_DOMAINS: Record<string, { label: string; icon: string }> = {
    sensor: { label: "Sensör", icon: "🌡️" },
    binary_sensor: { label: "Durum", icon: "📡" },
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
      .replace(/[̀-ͯ]/g, "")
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

  function toItem(e: HaEntity): Item {
    const name = String(e.attributes.friendly_name ?? e.entity_id);
    const meta = META[domainOf(e.entity_id)];
    return { e, name, fname: fold(name), hay: fold(`${name} ${e.entity_id} ${meta.label}`), meta };
  }

  $: items = Object.values($entities)
    .filter((e) => DOMAINS[domainOf(e.entity_id)])
    .map(toItem);

  $: sensorItems = withSensors
    ? Object.values($entities)
        .filter((e) => SENSOR_DOMAINS[domainOf(e.entity_id)])
        .map(toItem)
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

  $: dEntity = detailId ? $entities[detailId] : undefined;
  $: dMeta = detailId ? META[domainOf(detailId)] : undefined;
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

  function stateLabel(it: Item): string {
    const { state } = it.e;
    const d = domainOf(it.e.entity_id);
    if (state === "unavailable") return "Yok";
    if (d === "automation") return state === "on" ? "Etkin" : "Devre dışı";
    if (BUTTONY.has(d)) return "";
    if (d === "binary_sensor") return state === "on" ? "Aktif" : state === "off" ? "Pasif" : state;
    if (d === "lock") return state === "locked" ? "Kilitli" : state === "unlocked" ? "Kilit açık" : state;
    if (d === "cover") return state === "open" ? "Açık" : state === "closed" ? "Kapalı" : state === "opening" ? "Açılıyor" : state === "closing" ? "Kapanıyor" : state;
    if (d === "climate") return state === "off" ? "Kapalı" : (HVAC_TR[state] ?? state);
    if (d === "media_player") return state === "playing" ? "Çalıyor" : state === "paused" ? "Duraklatıldı" : state === "off" ? "Kapalı" : state === "idle" ? "Boşta" : state;
    if (state === "on") return "Açık";
    if (state === "off") return "Kapalı";
    const unit = it.e.attributes.unit_of_measurement;
    return unit ? `${state} ${unit}` : state;
  }

  function activate(e: HaEntity, alt = false) {
    if ($status !== "connected") {
      note = "HA'ya bağlı değil";
      return;
    }
    const id = e.entity_id;
    const d = domainOf(id);
    // Sensörler salt okunur: sayısal olanın grafiği açılır
    if (isSensorDomain(e)) {
      if (hasMore(e)) openDetail(e);
      else note = "Salt okunur";
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
      const c = raw.connection ?? {};
      const urls = [c.primaryUrl, c.fallbackUrl].filter(
        (u) => typeof u === "string" && u.trim()
      ) as string[];
      const token = (await invoke("get_token")) as string | null;
      if (!token || urls.length === 0) {
        note = "Önce ana pencerede bağlantıyı ayarla";
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
  function hintFor(it?: Item): string {
    if (!it) return "Esc kapat";
    const d = domainOf(it.e.entity_id);
    const k = kindOf(it.e);
    const more = hasMore(it.e) ? " · → ayrıntı" : "";
    if (isSensorDomain(it.e)) return hasMore(it.e) ? "Enter grafik · Esc kapat" : "Salt okunur · Esc kapat";
    if (DETAIL_ONLY.has(k)) return "Enter ayrıntı · Esc kapat";
    if (k === "cover") return `Enter aç/kapat · → ayrıntı · Esc kapat`;
    if (d === "automation") return "Enter tetikle · Shift+Enter etkin/devre dışı · Esc kapat";
    if (BUTTONY.has(d)) return "Enter çalıştır · Esc kapat";
    return `Enter aç/kapat${more} · Esc kapat`;
  }

  async function onShow() {
    query = "";
    sel = 0;
    note = "";
    detailId = null;
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
      placeholder="Ara: ışık, sahne, script, otomasyon…"
      spellcheck="false"
      autocomplete="off"
    />
  </div>

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
          <span class="id">{it.e.entity_id}</span>
        </span>
        {#if stateLabel(it)}
          <span class="pill" class:on={it.e.state === "on"}>{stateLabel(it)}</span>
        {/if}
        <span class="dom">{it.meta.label}</span>
        {#if hasMore(it.e)}
          <button class="more" title="Ayrıntı" on:click|stopPropagation={() => openDetail(it.e)}>›</button>
        {/if}
      </div>
    {:else}
      <div class="empty">
        {#if $status !== "connected"}
          Bağlanıyor…
        {:else if query}
          Sonuç yok
        {:else}
          Varlık bulunamadı
        {/if}
      </div>
    {/each}
  </div>

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
          <button class="x" title="Kapat (Esc)" on:click={closeDetail}>✕</button>
        </div>
        {#if !dEntity}
          <div class="empty">Varlık bulunamadı</div>
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
    {:else if detailId}
      <span>Esc geri</span>
    {:else}
      <span>↑↓ seç · {hintFor(results[sel])}</span>
    {/if}
    <span>{$status === "connected" ? (detailId ? "canlı" : `${results.length} sonuç`) : "bağlı değil"}</span>
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
