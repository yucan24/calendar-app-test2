"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserAttendance } from "./actions";

type AttendanceSelectProps = {
  eventId: string;
  userId: string;
  defaultStatus?: string | null;
};

function statusClass(status: string) {
  if (status === "attend") return "bg-green-100 text-green-800";
  if (status === "absent") return "bg-red-100 text-red-800";
  if (status === "pending") return "bg-yellow-100 text-yellow-800";
  return "bg-gray-100 text-gray-600";
}

export default function AttendanceSelect({
  eventId,
  userId,
  defaultStatus,
}: AttendanceSelectProps) {
  const router = useRouter();
  const [status, setStatus] = useState(defaultStatus || "");
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");

  function handleChange(nextStatus: string) {
    setStatus(nextStatus);
    setErrorMessage("");

    startTransition(async () => {
      try {
        await updateUserAttendance(eventId, userId, nextStatus);
        router.refresh();
      } catch {
        setErrorMessage("保存に失敗しました");
      }
    });
  }

  return (
    <div>
      <select
        value={status}
        onChange={(event) => handleChange(event.target.value)}
        disabled={isPending}
        className={`w-full rounded border px-2 py-1 text-[11px] ${statusClass(
          status
        )}`}
      >
        <option value="">未回答</option>
        <option value="attend">〇</option>
        <option value="pending">△</option>
        <option value="absent">×</option>
      </select>

      <div className="mt-1 min-h-4 text-[10px]">
        {isPending && <span className="text-gray-500">保存中...</span>}
        {!isPending && !errorMessage && status && (
          <span className="text-gray-500">保存済み</span>
        )}
        {errorMessage && <span className="text-red-600">{errorMessage}</span>}
      </div>
    </div>
  );
}