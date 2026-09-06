type DeepSeekPricePeriod = "peak" | "off_peak";

// DeepSeek's current published schedule is in UTC and applies on weekdays. Keep this in one
// place so policy decisions and status text cannot drift apart when the provider changes pricing.
const PEAK_WINDOWS_UTC = [
  { startMinutes: 1 * 60, endMinutes: 4 * 60 },
  { startMinutes: 6 * 60, endMinutes: 10 * 60 },
] as const;

export function deepSeekPricingPeriod(now = new Date()): DeepSeekPricePeriod {
  const weekday = now.getUTCDay();
  if (weekday === 0 || weekday === 6) return "off_peak";
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return PEAK_WINDOWS_UTC.some(
    ({ startMinutes, endMinutes }) => minutes >= startMinutes && minutes < endMinutes,
  )
    ? "peak"
    : "off_peak";
}

export function nextPricingTransition(now = new Date()): Date {
  const candidates: Date[] = [];
  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const day = new Date(now.getTime());
    day.setUTCDate(day.getUTCDate() + dayOffset);
    day.setUTCHours(0, 0, 0, 0);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const { startMinutes, endMinutes } of PEAK_WINDOWS_UTC) {
      for (const minutes of [startMinutes, endMinutes]) {
        const candidate = new Date(day.getTime() + minutes * 60_000);
        if (candidate.getTime() > now.getTime()) candidates.push(candidate);
      }
    }
  }
  // The weekend transition is technically a policy boundary even though both sides are off-peak.
  // Returning Monday 01:00 keeps the status countdown useful across a weekend.
  if (candidates.length === 0) {
    const monday = new Date(now.getTime());
    monday.setUTCDate(monday.getUTCDate() + 1);
    monday.setUTCHours(1, 0, 0, 0);
    while (monday.getUTCDay() === 0 || monday.getUTCDay() === 6) {
      monday.setUTCDate(monday.getUTCDate() + 1);
    }
    return monday;
  }
  return candidates.sort((left, right) => left.getTime() - right.getTime())[0]!;
}

export function pricingPeriodAtUtc(iso: string): DeepSeekPricePeriod {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid UTC timestamp: ${iso}`);
  return deepSeekPricingPeriod(parsed);
}
