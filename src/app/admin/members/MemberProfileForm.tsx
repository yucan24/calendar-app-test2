import SubmitButton from "@/components/SubmitButton";
type Member = { id: string; name: string; email: string | null };
export default function MemberProfileForm({ member, action, pending }: { member: Member; action: (form: FormData) => void; pending: boolean }) {
  return <form action={action} className="mt-4 space-y-4">
    <input type="hidden" name="operation" value="profile" /><input type="hidden" name="member_id" value={member.id} />
    <label className="block text-sm font-bold">名前<input name="name" defaultValue={member.name} required maxLength={100} className="mt-1 w-full rounded-lg border border-gray-400 p-3" /></label>
    <label className="block text-sm font-bold">メールアドレス<input type="email" name="email" defaultValue={member.email || ""} required maxLength={254} className="mt-1 w-full rounded-lg border border-gray-400 p-3" /></label>
    <SubmitButton disabled={pending} className="rounded-lg bg-gray-900 px-4 py-3 font-bold text-white">保存</SubmitButton>
  </form>;
}
