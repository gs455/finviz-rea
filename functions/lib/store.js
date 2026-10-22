// Snapshot and after-hours objects from R2, decoded once per isolate and re-validated by etag.
// Class B ops: one head() per object per CHECK_MS per isolate, one get() only when the etag changed. KV is never used.
import { readSnapshot } from "../../jobs/lib/snapshot.mjs";

const CHECK_MS = 60_000;
const slots = { snapshot: { key: "snapshot/latest.bin" }, ah: { key: "ah/latest.bin" } };

async function load(env, slot) {
  const now = Date.now();
  if (slot.decoded !== undefined && now - slot.checked < CHECK_MS) return slot.decoded;
  const head = await env.DATA.head(slot.key);
  slot.checked = now;
  if (!head) { slot.decoded = null; slot.etag = null; return null; }
  if (head.etag !== slot.etag) {
    const obj = await env.DATA.get(slot.key);
    slot.decoded = readSnapshot(await obj.arrayBuffer());
    slot.etag = head.etag;
  }
  return slot.decoded;
}

export async function loadStore(env) {
  const [snap, ah] = await Promise.all([load(env, slots.snapshot), load(env, slots.ah)]);
  return { snap, ah };
}
