import SubmitButton from "@/components/SubmitButton";
import {
  createPaymentAlias,
  deletePaymentAlias,
  updatePaymentAlias,
} from "./actions";
import type { BankProfile, PaymentAlias } from "./types";

type Props = {
  users: BankProfile[];
  aliases: PaymentAlias[];
};

const fieldClass =
  "mt-1 block w-full rounded border border-gray-400 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500";

export default function PaymentAliasPanel({ users, aliases }: Props) {
  return (
    <section id="aliases" className="rounded-lg bg-white p-5 shadow">
      <div>
        <h2 className="text-xl font-bold text-gray-900">口座名義設定</h2>
        <p className="mt-1 text-sm font-medium text-gray-700">
          保護者名義やカタカナ表記など、摘要に現れる振込名義をユーザーへ登録します。
        </p>
      </div>

      <form
        action={createPaymentAlias}
        className="mt-4 grid gap-3 rounded border border-gray-300 bg-gray-50 p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <label className="block text-sm font-bold text-gray-900">
            ユーザー
          </label>
          <select name="profile_id" required className={fieldClass}>
            <option value="">選択してください</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-900">
            口座名義
          </label>
          <input
            name="alias_name"
            required
            className={fieldClass}
            placeholder="例：ヤマダ ハナコ"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-900">備考</label>
          <input
            name="note"
            className={fieldClass}
            placeholder="例：母名義"
          />
        </div>

        <div className="flex items-end">
          <SubmitButton className="w-full rounded bg-black px-4 py-2 font-bold text-white">
            名義を追加
          </SubmitButton>
        </div>
      </form>

      <div className="mt-4 space-y-3">
        {aliases.length === 0 ? (
          <p className="rounded bg-gray-100 p-4 text-sm font-medium text-gray-700">
            口座名義はまだ登録されていません。
          </p>
        ) : (
          aliases.map((alias) => (
            <details key={alias.id} className="rounded border border-gray-300">
              <summary className="cursor-pointer px-4 py-3 font-bold text-gray-900">
                {alias.profileName}：{alias.aliasName}
                {alias.note && (
                  <span className="ml-2 text-sm font-medium text-gray-600">
                    （{alias.note}）
                  </span>
                )}
              </summary>

              <div className="grid gap-3 border-t border-gray-200 p-4 sm:grid-cols-[1fr_1fr_auto_auto]">
                <form
                  action={updatePaymentAlias}
                  className="contents"
                >
                  <input type="hidden" name="alias_id" value={alias.id} />
                  <div>
                    <label className="block text-xs font-bold text-gray-700">
                      口座名義
                    </label>
                    <input
                      name="alias_name"
                      required
                      defaultValue={alias.aliasName}
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700">
                      備考
                    </label>
                    <input
                      name="note"
                      defaultValue={alias.note ?? ""}
                      className={fieldClass}
                    />
                  </div>
                  <div className="flex items-end">
                    <SubmitButton className="rounded bg-gray-900 px-4 py-2 font-bold text-white">
                      更新
                    </SubmitButton>
                  </div>
                </form>

                <form action={deletePaymentAlias} className="flex items-end">
                  <input type="hidden" name="alias_id" value={alias.id} />
                  <SubmitButton className="rounded border border-red-300 bg-red-50 px-4 py-2 font-bold text-red-700">
                    削除
                  </SubmitButton>
                </form>
              </div>
            </details>
          ))
        )}
      </div>
    </section>
  );
}
