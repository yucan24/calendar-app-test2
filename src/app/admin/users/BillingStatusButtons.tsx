"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateBillingItemStatus } from "./actions";

type BillingStatus = "paid" | "unpaid" | "exempt";

type BillingStatusButtonsProps = {
  itemId: string;
  currentStatus: string;
};

const statusOptions: Array<{
  status: BillingStatus;
  label: string;
  activeClass: string;
  inactiveClass: string;
}> = [
  {
    status: "paid",
    label: "済",
    activeClass: "bg-green-600 text-white ring-green-700",
    inactiveClass: "border border-green-200 bg-green-50 text-green-800",
  },
  {
    status: "unpaid",
    label: "未",
    activeClass: "bg-red-600 text-white ring-red-700",
    inactiveClass: "border border-red-200 bg-red-50 text-red-800",
  },
  {
    status: "exempt",
    label: "免除",
    activeClass: "bg-gray-700 text-white ring-gray-800",
    inactiveClass: "border border-gray-300 bg-gray-100 text-gray-800",
  },
];

function normalizeStatus(value: string): BillingStatus {
  if (value === "paid" || value === "exempt") return value;
  return "unpaid";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "更新に失敗しました";
}

export default function BillingStatusButtons({
  itemId,
  currentStatus,
}: BillingStatusButtonsProps) {
  const router = useRouter();
  const [localStatus, setLocalStatus] = useState<BillingStatus>(
    normalizeStatus(currentStatus)
  );
  const [savingStatus, setSavingStatus] = useState<BillingStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const savingRef = useRef(false);

  const isSaving = savingStatus !== null;

  async function updateStatus(nextStatus: BillingStatus) {
    if (savingRef.current || isSaving || nextStatus === localStatus) return;

    savingRef.current = true;
    setSavingStatus(nextStatus);
    setErrorMessage("");

    const formData = new FormData();
    formData.set("item_id", itemId);
    formData.set("status", nextStatus);

    try {
      await updateBillingItemStatus(formData);
      setLocalStatus(nextStatus);
      router.refresh();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      savingRef.current = false;
      setSavingStatus(null);
    }
  }

  return (
    <div className="sm:w-72">
      <div className="grid grid-cols-3 gap-2" aria-busy={isSaving}>
        {statusOptions.map((option) => {
          const isActive = localStatus === option.status;

          return (
            <button
              key={option.status}
              type="button"
              disabled={isSaving || isActive}
              aria-pressed={isActive}
              onClick={() => updateStatus(option.status)}
              className={[
                "w-full rounded px-3 py-2 text-sm font-bold transition",
                "disabled:pointer-events-none disabled:cursor-not-allowed",
                isSaving
                  ? "bg-gray-200 text-gray-500 opacity-70"
                  : isActive
                    ? `${option.activeClass} ring-2 ring-offset-2`
                    : `${option.inactiveClass} hover:brightness-95`,
              ].join(" ")}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {errorMessage && (
        <div className="mt-1 text-xs font-bold">
          <span className="text-red-700">{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
