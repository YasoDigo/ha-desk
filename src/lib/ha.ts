import { writable } from "svelte/store";

export type HaEntity = {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
};

export type ConnStatus = "disconnected" | "connecting" | "connected" | "auth_failed";

export const status = writable<ConnStatus>("disconnected");
export const entities = writable<Record<string, HaEntity>>({});
export const lastError = writable<string>("");
export const activeUrl = writable<string>("");

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

function normalize(input: string): string {
  let u = input.trim().replace(/\/+$/, "");
  if (!/^[a-z]+:\/\//i.test(u)) u = "http://" + u;
  return u;
}

function toWsUrl(base: string): string {
  return base.replace(/^http/i, "ws") + "/api/websocket"; // http -> ws, https -> wss
}

class HaClient {
  private ws: WebSocket | null = null;
  private bases: string[] = [];
  private idx = 0;
  private authed = false;
  private token = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private wanted = false;

  onRename: ((oldId: string, newId: string) => void) | null = null;

  connect(urls: string[], token: string) {
    this.stop();
    this.bases = urls.map((u) => u.trim()).filter(Boolean).map(normalize);
    if (this.bases.length === 0) {
      lastError.set("Adres girilmedi");
      return;
    }
    this.token = token.trim();
    this.wanted = true;
    this.retry = 0;
    this.idx = 0;
    lastError.set("");
    this.open();
  }

  disconnect() {
    this.stop();
    status.set("disconnected");
    activeUrl.set("");
  }

  call<T = any>(payload: object): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("Bağlı değil"));
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, ...payload }));
    });
  }

  callService(
    domain: string,
    service: string,
    entityId?: string,
    data: Record<string, any> = {}
  ) {
    return this.call({
      type: "call_service",
      domain,
      service,
      service_data: data,
      target: entityId ? { entity_id: entityId } : undefined,
    });
  }

  // ---- iç işler ----

  private stop() {
    this.wanted = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.teardown();
  }

  private teardown() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      ws.close();
    }
    for (const p of this.pending.values()) p.reject(new Error("Bağlantı kapandı"));
    this.pending.clear();
  }

  private open() {
    this.authed = false;
    status.set("connecting");
    const base = this.bases[this.idx];
    let ws: WebSocket;
    try {
      ws = new WebSocket(toWsUrl(base));
    } catch (e) {
      lastError.set(`Geçersiz adres: ${base}`);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    ws.onerror = () => lastError.set(`Bağlanamadı: ${base}`);
    ws.onclose = () => {
      this.teardown();
      if (this.wanted) this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (!this.wanted) return;
    status.set("disconnected");
    activeUrl.set("");
    // Bağlantı hiç kurulamadıysa sıradaki adrese geç; kurulup koptuysa baştan (birincil) dene.
    this.idx = this.authed ? 0 : (this.idx + 1) % this.bases.length;
    const wrapped = this.idx === 0;
    const delay = wrapped ? Math.min(30000, 1000 * 2 ** this.retry) : 300;
    if (wrapped) this.retry++;
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private onMessage(msg: any) {
    switch (msg.type) {
      case "auth_required":
        this.ws?.send(JSON.stringify({ type: "auth", access_token: this.token }));
        break;
      case "auth_ok":
        this.authed = true;
        this.retry = 0;
        lastError.set("");
        activeUrl.set(this.bases[this.idx]);
        status.set("connected");
        this.afterAuth();
        break;
      case "auth_invalid":
        lastError.set("Token geçersiz");
        this.wanted = false;
        this.teardown();
        status.set("auth_failed");
        break;
      case "result":
      case "pong": {
        const p = this.pending.get(msg.id);
        if (!p) break;
        this.pending.delete(msg.id);
        if (msg.type === "result" && !msg.success) {
          p.reject(new Error(msg.error?.message ?? "Komut hatası"));
        } else {
          p.resolve(msg.result);
        }
        break;
      }
      case "event":
        this.onEvent(msg.event);
        break;
    }
  }

  private async afterAuth() {
    try {
      await this.call({ type: "subscribe_events", event_type: "state_changed" });
      await this.call({ type: "subscribe_events", event_type: "entity_registry_updated" });
      const states = await this.call<any[]>({ type: "get_states" });
      const map: Record<string, HaEntity> = {};
      for (const s of states) {
        map[s.entity_id] = { entity_id: s.entity_id, state: s.state, attributes: s.attributes };
      }
      entities.set(map);

      this.pingTimer = setInterval(async () => {
        try {
          await Promise.race([
            this.call({ type: "ping" }),
            new Promise((_, rej) => setTimeout(() => rej(new Error("ping zaman aşımı")), 10000)),
          ]);
        } catch {
          this.teardown();
          this.scheduleRetry();
        }
      }, 30000);
    } catch (e) {
      lastError.set(String(e));
    }
  }

  private onEvent(ev: any) {
    if (ev?.event_type === "entity_registry_updated") {
      const d = ev.data;
      if (d?.action === "update" && d.old_entity_id && d.old_entity_id !== d.entity_id) {
        this.onRename?.(d.old_entity_id, d.entity_id);
      }
      return;
    }
    if (ev?.event_type !== "state_changed") return;
    const { entity_id, new_state } = ev.data;
    entities.update((all) => {
      if (new_state) {
        all[entity_id] = { entity_id, state: new_state.state, attributes: new_state.attributes };
      } else {
        delete all[entity_id];
      }
      return all;
    });
  }
}

export const ha = new HaClient();
