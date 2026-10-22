// Client-side session classification of a bar timestamp (mirrors functions/lib/calendar.js).
const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
});

export function nyInfo(epochSec) {
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date(epochSec * 1000))) p[type] = value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function sessionOf(minutes) {
  if (minutes < 9 * 60 + 30) return "pre";
  if (minutes < 16 * 60) return "regular";
  return "post";
}
