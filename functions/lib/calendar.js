// US equity session calendar (regular + extended hours), all in America/New_York.
// Sessions: pre 04:00-09:30, regular 09:30-16:00, post 16:00-20:00.

const NY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
});

export const SESSION = { PRE_OPEN: 4 * 60, OPEN: 9 * 60 + 30, CLOSE: 16 * 60, POST_CLOSE: 20 * 60 };

// Full-day NYSE holidays (extend yearly). Early closes (13:00) are listed separately.
export const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
export const EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24"]);

/** Wall-clock parts of a UTC instant (seconds) in New York. */
export function nyParts(epochSec) {
  const p = {};
  for (const { type, value } of NY.formatToParts(new Date(epochSec * 1000))) p[type] = value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: p.weekday,
  };
}

export function isTradingDay(dateStr, weekday) {
  if (weekday === undefined) {
    weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" })
      .format(new Date(dateStr + "T12:00:00Z"));
  }
  return weekday !== "Sat" && weekday !== "Sun" && !HOLIDAYS.has(dateStr);
}

/** "pre" | "regular" | "post" | "closed" for a UTC instant in seconds. */
export function sessionAt(epochSec) {
  const { date, minutes, weekday } = nyParts(epochSec);
  if (!isTradingDay(date, weekday)) return "closed";
  const close = EARLY_CLOSE.has(date) ? 13 * 60 : SESSION.CLOSE;
  if (minutes < SESSION.PRE_OPEN) return "closed";
  if (minutes < SESSION.OPEN) return "pre";
  if (minutes < close) return "regular";
  if (minutes < SESSION.POST_CLOSE) return "post";
  return "closed";
}

/** Most recent trading dates (newest last), ending at or before the instant. */
export function recentTradingDays(epochSec, count) {
  const days = [];
  let t = epochSec;
  while (days.length < count) {
    const { date, weekday } = nyParts(t);
    if (isTradingDay(date, weekday) && !days.includes(date)) days.unshift(date);
    t -= 6 * 3600;
    if (epochSec - t > 40 * 86400) break;
  }
  return days;
}

/** Epoch seconds of the ISO start of 04:00 New York on a date (handles DST by probing). */
export function preOpenEpoch(dateStr) {
  const guess = Date.parse(dateStr + "T08:00:00Z") / 1000; // 04:00 EDT
  for (const t of [guess, guess + 3600]) {
    const p = nyParts(t);
    if (p.date === dateStr && p.minutes === SESSION.PRE_OPEN) return t;
  }
  return guess;
}

/** Bar-slot count of a full extended day for a bar size in minutes. */
export function slotsPerDay(barMinutes) {
  return Math.ceil((SESSION.POST_CLOSE - SESSION.PRE_OPEN) / barMinutes);
}
