import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { isValidDate } from "@/lib/month";

type PageProps = {
  searchParams?: Promise<{ year?: string; month?: string; date?: string }>;
};

// Keep old links working through the calendar that verifies the logged-in team.
export default async function AdminCalendarDayPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params?.year && /^\d{4}$/.test(params.year)) query.set("year", params.year);
  if (params?.month && /^(?:[1-9]|1[0-2])$/.test(params.month)) query.set("month", params.month);
  if (params?.date && isValidDate(params.date)) query.set("date", params.date);
  redirect(`/admin/calendar${query.size ? `?${query}` : ""}`);
}
