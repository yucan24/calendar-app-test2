import { redirect } from "next/navigation";
import { isValidTargetMonth } from "@/lib/month";

type PageProps = {
  searchParams?: Promise<{
    month?: string;
  }>;
};

export default async function AdminBankReconciliationPage({
  searchParams,
}: PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const month =
    resolvedSearchParams?.month && isValidTargetMonth(resolvedSearchParams.month)
      ? `&month=${resolvedSearchParams.month}`
      : "";

  redirect(`/admin/accounting?tab=reconciliation${month}`);
}
