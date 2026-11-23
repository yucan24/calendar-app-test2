import SubmitButton from "@/components/SubmitButton";
type Member = { id: string; name: string; email: string | null };
export default function MemberProfileForm({ member, action, pending }: { member: Member; action: (form: FormData) => void; pending: boolean }) {
  return <form action={action} className="mt-4 space-y-4">
    <input type="hidden" name="operation" value="profile" /><input type="hidden" name="member_id" value={member.id} />
    <label className="block text-sm font-bold">名前<input name="name" defaultValue={member.name} required maxLength={100} className="ui-field mt-1 w-full" /></label>
    <label className="block text-sm font-bold">メールアドレス<input type="email" name="email" defaultValue={member.email || ""} required maxLength={254} className="ui-field mt-1 w-full" /></label>
    <SubmitButton disabled={pending} className="ui-button ui-button-primary">保存</SubmitButton>
  </form>;
}
