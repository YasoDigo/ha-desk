<script lang="ts">
  import { entities, status } from "$lib/ha";
  import { rules, settings } from "$lib/config";
  import type { Rule, RuleWhen } from "$lib/config";
  import { addRule, removeRule, patchRule, setWhenType, testRule } from "$lib/notify";
  import { mobileInfo, sendTest, SERVICE } from "$lib/mobile";
  import { t } from "$lib/i18n";
  import type { Key } from "$lib/i18n";

  const WHEN: [RuleWhen["type"], Key][] = [
    ["state", "rule.when.state"],
    ["change", "rule.when.change"],
    ["above", "rule.when.above"],
    ["below", "rule.when.below"],
    ["triggered", "rule.when.triggered"],
  ];

  // Aynı anda tek kural düzenlenir, diğerleri tek satıra iner
  let openId: string | null = null;
  let testMsg = "";
  let testing = false;

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
    if (r.entity_id === "") return $t("rule.pickEntity");
    if (r.when.type === "state" && r.when.to === "") return $t("rule.stateEmpty");
    return "";
  }

  // Durumsuz kurallar (değişim, çalıştırma) için "en az şu kadar sürerse" anlamsızdır
  const timed = (r: Rule) => r.when.type !== "change" && r.when.type !== "triggered";

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

  async function doTest() {
    testing = true;
    testMsg = "";
    testMsg = await sendTest();
    testing = false;
  }
</script>

<datalist id="n-ents">
  {#each Object.values($entities) as e (e.entity_id)}
    <option value={e.entity_id}>{nameOf(e.entity_id)}</option>
  {/each}
</datalist>

<label class="check">
  <input type="checkbox" bind:checked={$settings.notifications.enabled} />
  {$t("rule.master")}
</label>

<div class="box">
  <h4>{$t("hn.title")}</h4>

  <label class="check">
    <input type="checkbox" bind:checked={$settings.notifications.receive} />
    {$t("hn.receive")}
  </label>
  {#if $settings.notifications.receive}
    <p class="hint">{$t("hn.receiveHint", { service: SERVICE })}</p>
    <p class="stat" class:bad={$mobileInfo.push === "error"}>
      {#if $mobileInfo.push === "registering"}
        {$t("hn.registering")}
      {:else if $mobileInfo.push === "listening"}
        ● {$t("hn.listening")}
      {:else if $mobileInfo.push === "error"}
        {$mobileInfo.pushErr}
      {/if}
    </p>
    <div class="row">
      <button disabled={$status !== "connected" || $mobileInfo.push !== "listening" || testing} on:click={doTest}>
        {$t("hn.sendTest")}
      </button>
      {#if testMsg}<span class="warn">{testMsg}</span>{/if}
    </div>
  {/if}

  <label class="check">
    <input type="checkbox" bind:checked={$settings.notifications.mirror} />
    {$t("hn.mirror")}
  </label>
  {#if $settings.notifications.mirror}
    <p class="stat" class:bad={$mobileInfo.mirror === "error"}>
      {#if $mobileInfo.mirror === "listening"}
        ● {$t("hn.mirrorOn")}
      {:else if $mobileInfo.mirror === "error"}
        {$mobileInfo.mirrorErr}
      {/if}
    </p>
  {/if}
</div>

<h4 class="sec">{$t("rule.title")}</h4>

{#if $rules.length === 0}
  <p class="hint">{$t("rule.none")}</p>
{/if}

{#each $rules as r (r.id)}
  {#if openId === r.id}
    {@const p = problem(r)}
    <div class="rule">
      <div class="row">
        <input
          class="grow"
          value={r.name}
          placeholder={$t("rule.name")}
          on:change={(e) => patchRule(r.id, { name: e.currentTarget.value })}
        />
        <button class="icon" title={$t("rule.delete")} on:click={() => remove(r.id)}>✕</button>
      </div>

      <input
        list="n-ents"
        class:bad={r.entity_id !== "" && !$entities[r.entity_id]}
        value={r.entity_id}
        placeholder={$t("common.entityPh")}
        on:change={(e) => patchRule(r.id, { entity_id: e.currentTarget.value.trim() })}
      />

      <div class="row">
        <select
          class="grow"
          value={r.when.type}
          on:change={(e) => setWhenType(r.id, e.currentTarget.value as RuleWhen["type"])}
        >
          {#each WHEN as [k, label]}
            <option value={k}>{$t(label)}</option>
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
            placeholder={$t("rule.statePh")}
            on:change={(e) => patchRule(r.id, { when: { type: "state", to: e.currentTarget.value.trim() } })}
          />
        {:else if r.when.type === "above" || r.when.type === "below"}
          <input
            class="val"
            type="number"
            step="any"
            value={r.when.value}
            placeholder={$t("rule.thresholdPh")}
            on:change={(e) =>
              patchRule(r.id, {
                when: { type: r.when.type === "above" ? "above" : "below", value: +e.currentTarget.value },
              })}
          />
        {/if}
      </div>

      {#if timed(r)}
        <label class="inline">
          {$t("rule.forSec")}
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
        placeholder={$t("rule.titlePh")}
        on:change={(e) => patchRule(r.id, { title: e.currentTarget.value })}
      />
      <input
        value={r.body}
        placeholder={$t("rule.bodyPh")}
        on:change={(e) => patchRule(r.id, { body: e.currentTarget.value })}
      />

      <div class="row">
        <button class="primary" on:click={() => save(r.id)}>{$t("common.save")}</button>
        <button on:click={() => testRule(r)}>{$t("common.test")}</button>
        {#if p}<span class="warn">{p}</span>{/if}
      </div>
    </div>
  {:else}
    <div class="rule mini" class:off={!r.enabled}>
      <input
        type="checkbox"
        checked={r.enabled}
        title={$t("rule.toggle")}
        on:change={(e) => patchRule(r.id, { enabled: e.currentTarget.checked })}
      />
      <span class="nm" title={r.entity_id}>{r.name || r.entity_id || $t("rule.unnamed")}</span>
      <button class="small" on:click={() => testRule(r)}>{$t("common.test")}</button>
      <button class="small" on:click={() => (openId = r.id)}>{$t("common.edit")}</button>
    </div>
  {/if}
{/each}

<button on:click={add}>{$t("rule.add")}</button>

<style>
  .box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  h4 {
    margin: 0;
    font-size: 12px;
    opacity: 0.75;
  }
  .sec {
    margin-top: 2px;
  }
  .stat {
    margin: 0;
    font-size: 12px;
    color: #3ecf6e;
  }
  .stat.bad {
    color: #e5484d;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
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
