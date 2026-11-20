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
          role="alert"
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
        <label htmlFor="register-name" className="block text-sm font-bold text-gray-900">名前</label>
        <input
          id="register-name"
          name="name"
          required
          maxLength={100}
          className={fieldClass}
          placeholder="例：山田太郎"
          autoComplete="name"
        />
      </div>

      <div>
        <label htmlFor="register-email" className="block text-sm font-bold text-gray-900">
          メールアドレス
        </label>
        <input
          id="register-email"
          name="email"
          type="email"
          required
          maxLength={254}
          className={fieldClass}
          placeholder="例：example@example.com"
          autoComplete="email"
        />
      </div>


      <SubmitButton
        pendingText="申請を送信中..."
        className="w-full rounded-lg bg-blue-700 px-4 py-3 font-bold text-white hover:bg-blue-800"
      >
        登録を申請
      </SubmitButton>
    </form>
  );
}
