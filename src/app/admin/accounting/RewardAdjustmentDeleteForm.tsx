"use client";

import SubmitButton from "@/components/SubmitButton";
import { deleteCoachRewardAdjustment } from "./actions";

type Props = {
  adjustmentId: string;
};

export default function RewardAdjustmentDeleteForm({ adjustmentId }: Props) {
  return (
    <form
      action={deleteCoachRewardAdjustment}
      onSubmit={(event) => {
        if (!window.confirm("この報酬調整を削除しますか？")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="adjustment_id" value={adjustmentId} />
      <SubmitButton
        pendingText="削除中..."
        className="rounded border border-red-300 bg-white px-3 py-2 text-sm font-bold text-red-700"
      >
        削除
      </SubmitButton>
    </form>
  );
}
