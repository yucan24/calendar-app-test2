import LogoutButton from "@/components/LogoutButton";
import PageHeader from "@/components/ui/PageHeader";
import MenuCard from "@/components/ui/MenuCard";
import { requireUser } from "@/lib/auth";

export default async function UserPage() {
  const profile = await requireUser();
  return <main className="ui-page"><div className="mx-auto max-w-5xl">
    <PageHeader title="ユーザー画面" actions={<LogoutButton />}><p>{profile.name}</p></PageHeader>
    <div className="ui-menu-grid">
      <MenuCard href="/user/payment-check">支払い確認</MenuCard>
      <MenuCard href="/user/calendar">カレンダー</MenuCard>
      <MenuCard href="/account">アカウント設定</MenuCard>
      <MenuCard href="/feedback">開発者へのご意見</MenuCard>
    </div>
  </div></main>;
}
