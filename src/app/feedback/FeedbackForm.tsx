"use client";

import type { FormEvent } from "react";

const FEEDBACK_EMAIL = "bbstatus@gmail.com";

const fieldClass =
  "ui-field mt-1";

const categoryLabels: Record<string, string> = {
  usability: "操作性",
  bug: "不具合",
  request: "要望",
  other: "その他",
};

const urgencyLabels: Record<string, string> = {
  normal: "通常",
  urgent: "急ぎ",
};

function textValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function buildMailto(formData: FormData) {
  const category = textValue(formData, "category");
  const urgency = textValue(formData, "urgency");
  const pagePath = textValue(formData, "page_path");
  const message = textValue(formData, "message");
  const categoryLabel = categoryLabels[category] ?? "その他";
  const urgencyLabel = urgencyLabels[urgency] ?? "通常";

  const subject = `【calendar-app-test2】${categoryLabel}のご意見`;
  const body = [
    `種類：${categoryLabel}`,
    `優先度：${urgencyLabel}`,
    `該当ページ：${pagePath || "未入力"}`,
    "",
    "内容：",
    message,
  ].join("\n");

  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}

export default function FeedbackForm() {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    window.location.href = buildMailto(formData);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-5">
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
          <label className="ui-choice">
            <input
              type="radio"
              name="urgency"
              value="normal"
              defaultChecked
              className="sr-only"
            />
            通常
          </label>
          <label className="ui-choice">
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

      <button
        type="submit"
        className="ui-button ui-button-primary w-full"
      >
        送信
      </button>
    </form>
  );
}
