import { redirect } from "next/navigation";

export default function UserHistoryPage() {
  redirect("/user/payment-check#payment-history");
}
