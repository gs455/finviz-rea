import test from "node:test";
import assert from "node:assert/strict";
import { sessionAt, recentTradingDays, preOpenEpoch, slotsPerDay, nyParts } from "../functions/lib/calendar.js";

const at = (iso) => Date.parse(iso) / 1000;

test("sessions in EDT", () => {
  assert.equal(sessionAt(at("2026-10-21T07:59:00Z")), "closed"); // 03:59 ET
  assert.equal(sessionAt(at("2026-10-21T08:00:00Z")), "pre");
  assert.equal(sessionAt(at("2026-10-21T13:30:00Z")), "regular");
  assert.equal(sessionAt(at("2026-10-21T20:00:00Z")), "post");
  assert.equal(sessionAt(at("2026-10-22T00:00:00Z")), "closed"); // 20:00 ET
});

test("sessions in EST (after DST ends 2026-11-01)", () => {
  assert.equal(sessionAt(at("2026-11-02T09:00:00Z")), "pre"); // 04:00 ET
  assert.equal(sessionAt(at("2026-11-02T14:30:00Z")), "regular");
});

test("weekends, holidays, early close", () => {
  assert.equal(sessionAt(at("2026-10-24T15:00:00Z")), "closed"); // Saturday
  assert.equal(sessionAt(at("2026-11-26T15:00:00Z")), "closed"); // Thanksgiving
  assert.equal(sessionAt(at("2026-11-27T18:30:00Z")), "post"); // 13:30 ET early close
});

test("recentTradingDays skips weekend", () => {
  assert.deepEqual(recentTradingDays(at("2026-10-26T15:00:00Z"), 3), ["2026-10-22", "2026-10-23", "2026-10-26"]);
});

test("preOpenEpoch is 04:00 ET", () => {
  assert.equal(nyParts(preOpenEpoch("2026-10-21")).minutes, 240);
  assert.equal(nyParts(preOpenEpoch("2026-11-02")).minutes, 240);
});

test("slots per day", () => {
  assert.equal(slotsPerDay(3), 320);
  assert.equal(slotsPerDay(5), 192);
});
