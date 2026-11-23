import type { AccountState } from "@/lib/accountPolicy";

export type Member = { id: string; name: string; email: string; role: string; account_status: string; email_verified_at: string | null };
export type MemberNotice = { profile_id: string; kind: string; delivery_status: string; created_at: string };
export type MemberListState = AccountState & { memberId?: string };

export const memberFilters = [
  { id: "all", label: "すべて", statuses: ["pending", "review", "invited", "active", "suspended"] },
  { id: "pending", label: "承認待ち", statuses: ["pending", "review"] },
  { id: "invited", label: "本人の設定待ち", statuses: ["invited"] },
  { id: "active", label: "利用中", statuses: ["active"] },
  { id: "suspended", label: "利用停止", statuses: ["suspended"] },
  { id: "deleted", label: "削除済み", statuses: ["deleted"] },
];

export function filterMembers(members: Member[], filter: string, search: string) {
  const statuses = (memberFilters.find(item => item.id === filter) || memberFilters[0]).statuses;
  const query = search.replace(/\s+/g, "").toLocaleLowerCase();
  return members.filter(member => statuses.includes(member.account_status) && (!query || `${member.name}${member.email}`.replace(/\s+/g, "").toLocaleLowerCase().includes(query)));
}
