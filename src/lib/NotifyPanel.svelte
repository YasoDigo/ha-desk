<script lang="ts">
  import { entities } from "$lib/ha";
  import { rules, settings } from "$lib/config";
  import type { Rule, RuleWhen } from "$lib/config";
  import { addRule, removeRule, patchRule, setWhenType, testRule } from "$lib/notify";

  const WHEN: [RuleWhen["type"], string][] = [
    ["state", "Durum şuna dönünce"],
    ["change", "Durum her değiştiğinde"],
    ["above", "Değer şunun üstüne çıkınca"],
    ["below", "Değer şunun altına inince"],
  ];

  // Aynı anda tek kural düzenlenir, diğerleri tek satıra iner
  let openId: string | null = null;

  const nameOf = (id: string) => String($entities[id]?.attributes.friendly_name ?? id);

  // "Durum şuna dönünce" kutusu için öneriler
  function stateHints(id: string): string[] {
    const e = $entities[id];
    const list: string[] = Array.isArray(e?.attributes.options) ? [...e.attributes.options] : ["on", "off"];
    if (e && !list.includes(e.state)) list.push(e.state);
    return list;
  }

  // Kaydetmeyi engelleyen eksik var mı?
  function problem(r: Rule): string {
    if (r.entity_id === "") return "Önce bir varlık seç";
    if (r.when.type === "state" && r.when.to === "") return "Durum boş olamaz";
    return "";
  }

  function add() {
    openId = addRule();
  }

  function save(id: string) {
    const cur = $rules.find((x) => x.id === id);
    if (cur && problem(cur)) return;
    openId = null;
  }

  function remove(id: string) {
    removeRule(id);
    if (openId === id) openId = null;
  }
</script>

<datalist id="n-ents">
  {#each Object.values($entities) as e (e.entity_id)}
    <option value={e.entity_id}>{nameOf(e.entity_id)}</option>
  {/each}
</datalist>

<label class="check">
  <input type="checkbox" bind:checked={$settings.notifications.enabled} />
  Bildirimleri etkinleştir (ana anahtar)
</label>

{#if $rules.length === 0}
  <p class="hint">Henüz kural yok.</p>
{/if}

{#each $rules as r (r.id)}
  {#if openId === r.id}
    {@const p = problem(r)}
    <div class="rule">
      <div class="row">
        <input
          class="grow"
          value={r.name}
          placeholder="Kural adı"
          on:change={(e) => patchRule(r.id, { name: e.currentTarget.value })}
        />
        <button class="icon" title="Kuralı sil" on:click={() => remove(r.id)}>✕</button>
      </div>

      <input
        list="n-ents"
        class:bad={r.entity_id !== "" && !$entities[r.entity_id]}
        value={r.entity_id}
        placeholder="entity_id (yazarak ara)"
        on:change={(e) => patchRule(r.id, { entity_id: e.currentTarget.value.trim() })}
      />

      <div class="row">
        <select
          class="grow"
          value={r.when.type}
          on:change={(e) => setWhenType(r.id, e.currentTarget.value as RuleWhen["type"])}
        >
          {#each WHEN as [k, label]}
            <option value={k}>{label}</option>
          {/each}
        </select>

        {#if r.when.type === "state"}
          <datalist id="st-{r.id}">
            {#each stateHints(r.entity_id) as o}<option value={o}></option>{/each}
          </datalist>
          <input
            class="val"
            list="st-{r.id}"
            value={r.when.to}
            placeholder="örn. on"
            on:change={(e) => patchRule(r.id, { when: { type: "state", to: e.currentTarget.value.trim() } })}
          />
        {:else if r.when.type === "above" || r.when.type === "below"}
          <input
            class="val"
            type="number"
            step="any"
            value={r.when.value}
            placeholder="eşik"
            on:change={(e) =>
              patchRule(r.id, {
                when: { type: r.when.type === "above" ? "above" : "below", value: +e.currentTarget.value },
              })}
          />
        {/if}
      </div>

      {#if r.when.type !== "change"}
        <label class="inline">
          En az şu kadar sürerse (sn, 0 = hemen)
          <input
            class="num"
            type="number"
            min="0"
            step="1"
            value={r.forSec}
            on:change={(e) => patchRule(r.id, { forSec: Math.max(0, Math.round(+e.currentTarget.value || 0)) })}
          />
        </label>
      {/if}

      <input
        value={r.title}
        placeholder="Başlık  ({'{name}'} {'{state}'} {'{old}'} {'{unit}'})"
        on:change={(e) => patchRule(r.id, { title: e.currentTarget.value })}
      />
      <input
        value={r.body}
        placeholder="Metin"
        on:change={(e) => patchRule(r.id, { body: e.currentTarget.value })}
      />

      <div class="row">
        <button class="primary" on:click={() => save(r.id)}>Kaydet</button>
        <button on:click={() => testRule(r)}>Test et</button>
        {#if p}<span class="warn">{p}</span>{/if}
      </div>
    </div>
  {:else}
    <div class="rule mini" class:off={!r.enabled}>
      <input
        type="checkbox"
        checked={r.enabled}
        title="Kuralı aç/kapat"
        on:change={(e) => patchRule(r.id, { enabled: e.currentTarget.checked })}
      />
      <span class="nm" title={r.entity_id}>{r.name || r.entity_id || "Adsız kural"}</span>
      <button class="small" on:click={() => testRule(r)}>Test et</button>
      <button class="small" on:click={() => (openId = r.id)}>Düzenle</button>
    </div>
  {/if}
{/each}

<button on:click={add}>+ Kural ekle</button>

<style>
  .hint {
    opacity: 0.65;
    font-size: 12px;
    margin: 0;
  }
  .warn {
    align-self: center;
    font-size: 12px;
    color: var(--accent);
  }

  .rule {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 7px 8px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .rule.mini {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
  }
  .rule.off {
    opacity: 0.55;
  }
  .nm {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .val {
    width: 84px;
    flex: none;
  }
  .check {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .check input {
    padding: 0;
  }
  .inline {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
  }
  .num {
    width: 70px;
  }
  .bad {
    border-color: #e5484d !important;
  }

  input:not([type="checkbox"]),
  select,
  button {
    padding: 5px 8px;
    border-radius: 8px;
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: inherit;
    font-size: 12.5px;
    font-family: inherit;
  }
  button {
    cursor: pointer;
  }
  button:hover {
    background: var(--hover);
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #1a1a1a;
    font-weight: 600;
  }
  .primary:hover {
    background: var(--accent);
    filter: brightness(1.1);
  }
  .icon {
    padding: 2px 8px;
    font-size: 13px;
  }
  .small {
    padding: 3px 9px;
    font-size: 12px;
  }
</style>
