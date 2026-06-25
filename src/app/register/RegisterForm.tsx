"use client";

import { useActionState } from "react";
import SubmitButton from "@/components/SubmitButton";
import { registerMember, type RegisterState } from "./actions";

const initialState: RegisterState = {
  ok: false,
  message: "",
};

const fieldClass =
  "mt-1 block w-full rounded border border-gray-400 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-500";

export default function RegisterForm() {
  const [state, formAction] = useActionState(registerMember, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4">
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
        <label className="block text-sm font-bold text-gray-900">名前</label>
        <input
          name="name"
          className={fieldClass}
          placeholder="例：山田太郎"
          autoComplete="name"
        />
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-900">
          メールアドレス
        </label>
        <input
          name="email"
          type="email"
          className={fieldClass}
          placeholder="例：example@example.com"
          autoComplete="email"
        />
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-900">
          ログインコード
        </label>
        <input
          name="login_code"
          inputMode="numeric"
          maxLength={4}
          className={fieldClass}
          placeholder="4桁の数字"
        />
      </div>

      <SubmitButton
        pendingText="登録中..."
        className="w-full rounded bg-black px-4 py-3 font-bold text-white"
      >
        登録する
      </SubmitButton>
    </form>
  );
}
