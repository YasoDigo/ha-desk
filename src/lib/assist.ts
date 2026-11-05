import { ha } from "./ha";

// Home Assistant Assist'e yazıyla soru sorar (ses ve bulut gerekmez; HA'nın yerel varsayılan ajanı).
// Dil verilmez: HA kendi ayarındaki dili kullanır.

const KEEP_MS = 120_000; // konuşma bu süre içinde sürerse aynı konuşma kimliği kullanılır
let convId = "";
let convAt = 0;

export async function askAssist(text: string): Promise<string> {
  const payload: Record<string, unknown> = { type: "conversation/process", text };
  if (convId && Date.now() - convAt < KEEP_MS) payload.conversation_id = convId;
  const res = await ha.call<any>(payload);
  if (typeof res?.conversation_id === "string") {
    convId = res.conversation_id;
    convAt = Date.now();
  }
  const speech = res?.response?.speech?.plain?.speech;
  return typeof speech === "string" ? speech.trim() : "";
}
