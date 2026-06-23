"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAdminAttendance } from "./actions";

type AdminAttendanceSelectProps = {
  eventId: string;
  userId: string;
  defaultStatus?: string | null;
  defaultNote?: string | null;
};

function statusClass(status: string) {
  if (status === "attend") return "bg-green-100 text-green-800";
  if (status === "absent") return "bg-red-100 text-red-800";
  if (status === "pending") return "bg-yellow-100 text-yellow-800";
  return "bg-gray-100 text-gray-600";
}

export default function AdminAttendanceSelect({
  eventId,
  userId,
  defaultStatus,
  defaultNote,
}: AdminAttendanceSelectProps) {
  const router = useRouter();
  const [status, setStatus] = useState(defaultStatus || "");
  const [note, setNote] = useState(defaultNote || "");
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");

  function save(nextStatus: string, nextNote: string) {
    setErrorMessage("");

    startTransition(async () => {
      try {
        await updateAdminAttendance(eventId, userId, nextStatus, nextNote);
        router.refresh();
      } catch {
        setErrorMessage("保存に失敗しました");
      }
    });
  }

  function handleStatusChange(nextStatus: string) {
    setStatus(nextStatus);
    save(nextStatus, note);
  }

  function handleNoteBlur() {
    save(status, note);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium">出欠</label>
        <select
          value={status}
          onChange={(event) => handleStatusChange(event.target.value)}
          disabled={isPending}
          className={`mt-1 w-full rounded border px-3 py-2 text-sm ${statusClass(
            status
          )}`}
        >
          <option value="">未回答</option>
          <option value="attend">〇 出席</option>
          <option value="pending">△ 未定</option>
          <option value="absent">× 欠席</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium">備考</label>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={handleNoteBlur}
          disabled={isPending}
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
          placeholder="遅刻、早退、欠席理由など"
        />
        <p className="mt-1 text-xs text-gray-500">
          備考は入力後、欄の外をクリックすると保存されます。
        </p>
      </div>

      <div className="min-h-5 text-xs">
        {isPending && <span className="text-gray-500">保存中...</span>}
        {!isPending && !errorMessage && (
          <span className="text-gray-500">保存済み</span>
        )}
        {errorMessage && <span className="text-red-600">{errorMessage}</span>}
      </div>
    </div>
  );
}