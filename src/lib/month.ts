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
  return /^\d{4}-\d{2}$/.test(value);
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