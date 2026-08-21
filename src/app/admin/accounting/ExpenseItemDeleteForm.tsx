"use client";

import SubmitButton from "@/components/SubmitButton";
import { deleteAccountingExpenseItem } from "./actions";

type Props = {
  itemId: string;
};

export default function ExpenseItemDeleteForm({ itemId }: Props) {
  return (
    <form
      action={deleteAccountingExpenseItem}
      onSubmit={(event) => {
        if (!window.confirm("この出費項目を削除しますか？")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="item_id" value={itemId} />
      <SubmitButton
        pendingText="削除中..."
        className="rounded border border-red-300 bg-white px-3 py-2 text-sm font-bold text-red-700"
      >
        削除
      </SubmitButton>
    </form>
  );
}
