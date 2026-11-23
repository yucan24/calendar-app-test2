export type AccountState = { ok: boolean; message: string; url?: string };
export const initialAccountState: AccountState = { ok: false, message: "" };
export const normalizeAccountName = (value: unknown) => String(value ?? "").replace(/\s+/g, "").trim();
export const normalizeAccountEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();
export const validAccountEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const validAccountCode = (value: string) => /^[0-9]{4}$/.test(value);
export const accountStatusLabels: Record<string, string> = {
  pending: "承認待ち", invited: "初期設定待ち", active: "利用中", suspended: "利用停止",
  review: "要確認（以前のログイン不可）", deleted: "削除済み",
};
