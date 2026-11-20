import { redirect } from "next/navigation";
import { endSession } from "@/lib/auth";

export async function GET() {
  await endSession();

  redirect("/login");
}
