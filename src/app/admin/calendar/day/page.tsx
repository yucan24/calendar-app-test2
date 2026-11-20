import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { isValidDate, isValidTargetMonth } from "@/lib/month";

type PageProps = {
  searchParams?: Promise<{ year?: string; month?: string; date?: string }>;
};

// Keep old links working through the calendar that verifies the logged-in team.
export default async function AdminCalendarDayPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params?.date && isValidDate(params.date)) {
    query.set("month", params.date.slice(0, 7));
    query.set("date", params.date);
  } else if (isValidTargetMonth(params?.month)) {
    query.set("month", params!.month!);
  } else if (params?.year && /^(?!0000)\d{4}$/.test(params.year) && params.month && /^(?:0?[1-9]|1[0-2])$/.test(params.month)) {
    query.set("month", `${params.year}-${params.month.padStart(2, "0")}`);
  }
  redirect(`/admin/calendar${query.size ? `?${query}` : ""}`);
}
