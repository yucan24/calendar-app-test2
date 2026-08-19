"use client";

import { useActionState, useEffect, useRef } from "react";
import SubmitButton from "@/components/SubmitButton";
import { submitDeveloperFeedback, type FeedbackState } from "./actions";

const initialState: FeedbackState = {
  ok: false,
  message: "",
  submittedAt: null,
};

const fieldClass =
  "mt-1 block w-full min-w-0 max-w-full box-border rounded border border-gray-400 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-500";

export default function FeedbackForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(
    submitDeveloperFeedback,
    initialState
  );

  useEffect(() => {
    if (!state.ok || !state.submittedAt) return;

    formRef.current?.reset();
  }, [state.ok, state.submittedAt]);

  return (
    <form ref={formRef} action={formAction} className="mt-6 space-y-5">
      {state.message && (
        <div
          className={
            state.ok
              ? "rounded bg-green-100 p-3 font-bold text-green-800"
              : "rounded bg-red-100 p-3 font-bold text-red-700"
          }
        >
          {state.message}
        </div>
      )}

      <div>
        <label className="block text-sm font-bold text-gray-900">種類</label>
        <select name="category" defaultValue="usability" className={fieldClass}>
          <option value="usability">操作性</option>
          <option value="bug">不具合</option>
          <option value="request">要望</option>
          <option value="other">その他</option>
        </select>
      </div>

      <fieldset>
        <legend className="block text-sm font-bold text-gray-900">優先度</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="flex min-h-11 items-center justify-center rounded border border-gray-400 bg-white px-3 py-2 text-sm font-bold text-gray-900 has-checked:border-black has-checked:bg-black has-checked:text-white">
            <input
              type="radio"
              name="urgency"
              value="normal"
              defaultChecked
              className="sr-only"
            />
            通常
          </label>
          <label className="flex min-h-11 items-center justify-center rounded border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-bold text-orange-800 has-checked:border-orange-600 has-checked:bg-orange-600 has-checked:text-white">
            <input
              type="radio"
              name="urgency"
              value="urgent"
              className="sr-only"
            />
            急ぎ
          </label>
        </div>
      </fieldset>

      <div>
        <label className="block text-sm font-bold text-gray-900">
          該当ページ
        </label>
        <input
          name="page_path"
          maxLength={300}
          className={fieldClass}
          placeholder="例：支払い確認、カレンダー"
        />
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-900">内容</label>
        <textarea
          name="message"
          required
          maxLength={2000}
          rows={8}
          className={`${fieldClass} resize-y`}
          placeholder="気になった点、困った操作、改善してほしい内容"
        />
      </div>

      <SubmitButton
        pendingText="送信中..."
        className="w-full rounded bg-black px-4 py-3 font-bold text-white"
      >
        送信
      </SubmitButton>
    </form>
  );
}
