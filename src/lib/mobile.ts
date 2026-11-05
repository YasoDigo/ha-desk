import { get, writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { ha, status, activeUrl } from "./ha";
import { settings, mobile } from "./config";
import { notify } from "./notify";
import { tn } from "./i18n/core";

// HA'ya "mobil uygulama" olarak kaydolur: otomasyonlar notify.mobile_app_ha_desk ile
// bu bilgisayara bildirim atabilir. Bildirimler yerel websocket üzerinden gelir (bulut gerekmez).
// Ayrıca HA'nın zil panelindeki (persistent notification) bildirimleri Windows'a yansıtabilir.

export const DEVICE_NAME = "HA Desk";
export const SERVICE = "notify.mobile_app_ha_desk";
const APP_VERSION = "0.1.0";

// push mesajı olmayan, uygulamaya yönelik komutlar
const COMMANDS = new Set(["clear_notification", "request_location_update", "remove_channels"]);

export type MobileInfo = {
  push: "off" | "registering" | "listening" | "error";
  pushErr: string;
  mirror: "off" | "listening" | "error";
  mirrorErr: string;
};
export const mobileInfo = writable<MobileInfo>({ push: "off", pushErr: "", mirror: "off", mirrorErr: "" });
const setInfo = (p: Partial<MobileInfo>) => mobileInfo.update((i) => ({ ...i, ...p }));

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- kayıt ----------

let regPromise: Promise<string> | null = null;

// Aynı anda tek kayıt isteği gider (çift cihaz oluşmasın)
function registerDevice(): Promise<string> {
  if (!regPromise) regPromise = doRegister().finally(() => (regPromise = null));
  return regPromise;
}

async function doRegister(): Promise<string> {
  const base = get(activeUrl);
  const token = (await invoke("get_token")) as string | null;
  if (!base || !token) throw new Error(tn("hn.needConn"));

  let deviceId = get(mobile).deviceId;
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    mobile.update((m) => ({ ...m, deviceId }));
  }
  // WebView'dan doğrudan fetch CORS'a takılır; Tauri'nin http eklentisi bunu aşar
  const res = await httpFetch(`${base}/api/mobile_app/registrations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      device_id: deviceId,
      app_id: "com.yasodigo.ha-desk",
      app_name: "HA Desk",
      app_version: APP_VERSION,
      device_name: DEVICE_NAME,
      manufacturer: "HA Desk",
      model: "Windows",
      os_name: "Windows",
      os_version: "",
      supports_encryption: false,
      app_data: { push_websocket_channel: true },
    }),
  });
  if (res.status === 404) throw new Error(tn("hn.noMobileApp"));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { webhook_id?: string };
  const webhookId = String(j.webhook_id ?? "");
  if (!webhookId) throw new Error("no webhook_id in the response");
  mobile.update((m) => ({ ...m, webhookId }));
  return webhookId;
}

// ---------- gelen bildirimler ----------

function onPush(ev: any) {
  const n = get(settings).notifications;
  if (!n.enabled || !n.receive) return;
  const message = typeof ev?.message === "string" ? ev.message : "";
  if (!message || COMMANDS.has(message) || message.startsWith("command_")) return;
  notify(typeof ev.title === "string" && ev.title ? ev.title : DEVICE_NAME, message);
}

// Markdown işaretlerini sadeleştirir, çok uzun metni keser
const plain = (s: string) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`#>]/g, "")
    .trim()
    .slice(0, 400);

function onBell(ev: any, seen: Set<string>) {
  const n = get(settings).notifications;
  if (!n.enabled || !n.mirror) return;
  const list = (ev?.notifications ?? {}) as Record<string, any>;
  if (ev?.type === "current") {
    // Abonelik anındaki mevcut bildirimler tekrar gösterilmez
    for (const id of Object.keys(list)) seen.add(id);
    return;
  }
  if (ev?.type === "removed") {
    for (const id of Object.keys(list)) seen.delete(id);
    return;
  }
  if (ev?.type !== "added" && ev?.type !== "updated") return;
  for (const [id, item] of Object.entries(list)) {
    seen.add(id);
    const message = plain(String(item?.message ?? ""));
    const title = plain(String(item?.title ?? ""));
    if (!message && !title) continue;
    notify(title || tn("hn.ha"), message || title);
  }
}

// ---------- abonelikleri kur / kapat ----------

let stops: Array<() => void> = [];
let gen = 0;
let started = false;

async function startPush(my: number) {
  setInfo({ push: "registering", pushErr: "" });
  let retried = false;
  for (;;) {
    let id = get(mobile).webhookId;
    let justRegistered = false;
    if (!id) {
      try {
        id = await registerDevice();
        justRegistered = true;
      } catch (e) {
        if (my === gen) setInfo({ push: "error", pushErr: tn("hn.regFail", { err: msgOf(e) }) });
        return;
      }
    }
    if (my !== gen) return;
    try {
      const stop = await ha.subscribe(
        { type: "mobile_app/push_notification_channel", webhook_id: id, support_confirm: false },
        onPush
      );
      if (my !== gen) {
        stop();
        return;
      }
      stops.push(stop);
      setInfo({ push: "listening", pushErr: "" });
      return;
    } catch (e: any) {
      if (my !== gen) return;
      // Cihaz HA'dan silinmişse kimlik geçersizdir: bir kez yeniden kaydol
      if (e?.code === "not_found" && !retried && !justRegistered) {
        retried = true;
        mobile.update((m) => ({ ...m, webhookId: "" }));
        continue;
      }
      setInfo({ push: "error", pushErr: tn("hn.subFail", { err: msgOf(e) }) });
      return;
    }
  }
}

async function startMirror(my: number) {
  const seen = new Set<string>();
  try {
    const stop = await ha.subscribe({ type: "persistent_notification/subscribe" }, (ev) =>
      onBell(ev, seen)
    );
    if (my !== gen) {
      stop();
      return;
    }
    stops.push(stop);
    setInfo({ mirror: "listening", mirrorErr: "" });
  } catch (e) {
    if (my === gen) setInfo({ mirror: "error", mirrorErr: tn("hn.mirrorFail", { err: msgOf(e) }) });
  }
}

async function apply() {
  const my = ++gen;
  for (const s of stops) s();
  stops = [];
  setInfo({ push: "off", pushErr: "", mirror: "off", mirrorErr: "" });
  if (get(status) !== "connected") return;
  const n = get(settings).notifications;
  if (!n.enabled) return;
  if (n.receive) await startPush(my);
  if (my !== gen) return;
  if (n.mirror) await startMirror(my);
}

const keyOf = () => {
  const n = get(settings).notifications;
  return `${n.enabled}|${n.receive}|${n.mirror}`;
};
let lastKey = "";

// Ana pencere çağırır (palet penceresi bildirim dinlemez)
export function startMobile() {
  if (started) return;
  started = true;
  lastKey = keyOf();
  ha.onReady = () => {
    apply();
  };
  settings.subscribe(() => {
    const k = keyOf();
    if (k === lastKey) return;
    lastKey = k;
    apply();
  });
  if (get(status) === "connected") apply();
}

// Ayarlardaki "HA üzerinden test gönder" düğmesi; boş dönerse başarılı demektir
export async function sendTest(): Promise<string> {
  try {
    await ha.callService("notify", SERVICE.split(".")[1], undefined, {
      title: DEVICE_NAME,
      message: tn("hn.testMsg"),
    });
    return tn("hn.testSent");
  } catch (e) {
    return tn("hn.testFail", { err: msgOf(e) });
  }
}
