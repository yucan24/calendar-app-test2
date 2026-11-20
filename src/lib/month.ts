export function getCurrentTargetMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;

  return `${year}-${month}`;
}

export function isValidTargetMonth(value: string | undefined | null) {
  if (!value) return false;
  return /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isValidDate(value: string | undefined | null) {
  if (!value || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function formatTargetMonth(value: string) {
  const [year, month] = value.split("-");
  return `${year}年${Number(month)}月`;
}

export function getPrevTargetMonth(value: string) {
  const [year, month] = value.split("-").map(Number);

  if (month === 1) {
    return `${String(year - 1).padStart(4, "0")}-12`;
  }

  return `${String(year).padStart(4, "0")}-${String(month - 1).padStart(2, "0")}`;
}

export function getNextTargetMonth(value: string) {
  const [year, month] = value.split("-").map(Number);

  if (month === 12) {
    return `${String(year + 1).padStart(4, "0")}-01`;
  }

  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}`;
}

export function getJstDateKey(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")?.padStart(4, "0")}-${part("month")}-${part("day")}`;
}

export function getTargetMonthUtcRange(value: string) {
  if (!isValidTargetMonth(value)) throw new Error("対象月が不正です。");
  const start = new Date(`${value}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  start.setUTCHours(-9);
  end.setUTCHours(-9);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function formatYen(value: number) {
  return `${value.toLocaleString("ja-JP")}円`;
}
