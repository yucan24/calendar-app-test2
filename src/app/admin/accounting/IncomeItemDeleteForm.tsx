"use client";

import SubmitButton from "@/components/SubmitButton";
import { deleteAccountingIncomeItem } from "./actions";

type Props = {
  itemId: string;
};

export default function IncomeItemDeleteForm({ itemId }: Props) {
  return (
    <form
      action={deleteAccountingIncomeItem}
      onSubmit={(event) => {
        if (!window.confirm("この収入項目を削除しますか？")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="item_id" value={itemId} />
      <SubmitButton
        pendingText="削除中..."
        className="ui-button ui-button-danger"
      >
        削除
      </SubmitButton>
    </form>
  );
}
