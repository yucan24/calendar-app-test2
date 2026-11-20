import LogoutButton from "@/components/LogoutButton";
import PageHeader from "@/components/ui/PageHeader";
import MenuCard from "@/components/ui/MenuCard";
import { requireAdmin } from "@/lib/auth";

export default async function AdminPage() {
  const profile = await requireAdmin();
  return <main className="ui-page"><div className="mx-auto max-w-5xl">
    <PageHeader title="管理者画面" actions={<LogoutButton />}><p>{profile.name}</p></PageHeader>
    <div className="ui-menu-grid">
      <MenuCard href="/admin/members">会員管理</MenuCard>
      <MenuCard href="/admin/calendar">カレンダー</MenuCard>
      <MenuCard href="/admin/coach-work">指導者勤怠・立替管理</MenuCard>
      <MenuCard href="/admin/accounting">会計管理</MenuCard>
      <MenuCard href="/admin/users">ユーザー・請求管理</MenuCard>
      <MenuCard href="/account">アカウント設定</MenuCard>
    </div>
  </div></main>;
}
