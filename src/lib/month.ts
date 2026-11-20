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
    return `${year - 1}-12`;
  }

  return `${year}-${String(month - 1).padStart(2, "0")}`;
}

export function getNextTargetMonth(value: string) {
  const [year, month] = value.split("-").map(Number);

  if (month === 12) {
    return `${year + 1}-01`;
  }

  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function formatYen(value: number) {
  return `${value.toLocaleString("ja-JP")}円`;
}
