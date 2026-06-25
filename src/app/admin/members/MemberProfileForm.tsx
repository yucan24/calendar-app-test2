"use client";

import { useActionState } from "react";
import SubmitButton from "@/components/SubmitButton";
import {
  updateMemberProfile,
  type MemberActionState,
} from "./actions";

type Member = {
  id: string;
  name: string;
  email: string | null;
  login_code: string | null;
};

type Props = {
  member: Member;
};

const initialState: MemberActionState = {
  ok: false,
  message: "",
};

const fieldClass =
  "mt-1 block w-full rounded border border-gray-400 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-500";

export default function MemberProfileForm({ member }: Props) {
  const [state, formAction] = useActionState(
    updateMemberProfile,
    initialState
  );

  return (
    <form action={formAction} className="mt-3 space-y-3">
      {state.message && (
        <div
          className={
            state.ok
              ? "rounded bg-green-100 p-3 text-sm font-bold text-green-800"
              : "rounded bg-red-100 p-3 text-sm font-bold text-red-700"
          }
        >
          {state.message}
        </div>
      )}

      <input type="hidden" name="member_id" value={member.id} />

      <div>
        <label className="block text-sm font-bold text-gray-900">名前</label>
        <input
          name="name"
          defaultValue={member.name}
          className={fieldClass}
        />
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-900">
          メールアドレス
        </label>
        <input
          name="email"
          type="email"
          defaultValue={member.email ?? ""}
          className={fieldClass}
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
          defaultValue={member.login_code ?? ""}
          className={fieldClass}
        />
      </div>

      <SubmitButton
        pendingText="保存中..."
        className="w-full rounded bg-black px-4 py-2 font-bold text-white"
      >
        登録情報を保存
      </SubmitButton>
    </form>
  );
}
