"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCoachWorkLogs, updateCoachWorkLog } from "./actions";
import { formatTargetMonth, formatYen } from "@/lib/month";

type Coach = {
  id: string;
  name: string;
  email: string;
};

type CoachWorkLog = {
  id: string;
  batch_id: string;
  coach_id: string;
  entered_by: string | null;
  work_date: string;
  coaching_minutes: number;
  admin_minutes: number;
  travel_expense: number;
  other_expense: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type CalendarCell = {
  dateKey: string;
  day: number;
  isCurrentMonth: boolean;
};

type Props = {
  currentAdmin: {
    id: string;
    name: string;
  };
  targetMonth: string;
  currentMonth: string;
  prevMonth: string;
  nextMonth: string;
  todayKey: string;
  coaches: Coach[];
  logs: CoachWorkLog[];
};

const fieldClass =
  "mt-1 block w-full min-w-0 max-w-full box-border rounded border border-gray-400 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-500";

const weekLabels = ["月", "火", "水", "木", "金", "土", "日"];

function makeDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}

function createCalendarCells(targetMonth: string): CalendarCell[] {
  const [year, month] = targetMonth.split("-").map(Number);

  const firstDate = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0);

  const firstWeekIndex = (firstDate.getDay() + 6) % 7;
  const daysInMonth = lastDate.getDate();

  const cells: CalendarCell[] = [];

  const prevLastDate = new Date(year, month - 1, 0);
  const prevDaysInMonth = prevLastDate.getDate();

  for (let i = firstWeekIndex - 1; i >= 0; i--) {
    const day = prevDaysInMonth - i;
    const prevMonthDate = new Date(year, month - 2, day);

    cells.push({
      dateKey: makeDateKey(
        prevMonthDate.getFullYear(),
        prevMonthDate.getMonth() + 1,
        prevMonthDate.getDate()
      ),
      day,
      isCurrentMonth: false,
    });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({
      dateKey: makeDateKey(year, month, day),
      day,
      isCurrentMonth: true,
    });
  }

  let nextDay = 1;

  while (cells.length % 7 !== 0) {
    const nextMonthDate = new Date(year, month, nextDay);

    cells.push({
      dateKey: makeDateKey(
        nextMonthDate.getFullYear(),
        nextMonthDate.getMonth() + 1,
        nextMonthDate.getDate()
      ),
      day: nextDay,
      isCurrentMonth: false,
    });

    nextDay++;
  }

  return cells;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  if (hours === 0 && minutes === 0) return "0時間";
  if (minutes === 0) return `${hours}時間`;
  if (hours === 0) return `${minutes}分`;

  return `${hours}時間${minutes}分`;
}

function formatMinutesShort(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  if (hours === 0 && minutes === 0) return "0h";
  if (minutes === 0) return `${hours}h`;
  if (hours === 0) return `${minutes}m`;

  return `${hours}h${minutes}m`;
}

function getHourPart(value: number) {
  return Math.floor(value / 60);
}

function getMinutePart(value: number) {
  return value % 60;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "保存に失敗しました";
}

export default function CoachWorkCalendarClient({
  currentAdmin,
  targetMonth,
  currentMonth,
  prevMonth,
  nextMonth,
  todayKey,
  coaches,
  logs,
}: Props) {
  const router = useRouter();
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const coachNameById = useMemo(() => {
    const map = new Map<string, string>();

    for (const coach of coaches) {
      map.set(coach.id, coach.name);
    }

    return map;
  }, [coaches]);

  const cells = useMemo(() => createCalendarCells(targetMonth), [targetMonth]);

  const logsByDate = useMemo(() => {
    const map = new Map<string, CoachWorkLog[]>();

    for (const log of logs) {
      const list = map.get(log.work_date) ?? [];
      list.push(log);
      map.set(log.work_date, list);
    }

    return map;
  }, [logs]);

  const monthlySummaryByCoach = useMemo(() => {
    const map = new Map<
      string,
      {
        coachingMinutes: number;
        adminMinutes: number;
        travelExpense: number;
        otherExpense: number;
        count: number;
      }
    >();

    for (const coach of coaches) {
      map.set(coach.id, {
        coachingMinutes: 0,
        adminMinutes: 0,
        travelExpense: 0,
        otherExpense: 0,
        count: 0,
      });
    }

    for (const log of logs) {
      const summary = map.get(log.coach_id);

      if (!summary) continue;

      summary.coachingMinutes += log.coaching_minutes;
      summary.adminMinutes += log.admin_minutes;
      summary.travelExpense += log.travel_expense;
      summary.otherExpense += log.other_expense;
      summary.count += 1;
    }

    return map;
  }, [coaches, logs]);

  const selectedLogs = selectedDateKey
    ? logsByDate.get(selectedDateKey) ?? []
    : [];

  function closeModal() {
    setSelectedDateKey(null);
    setErrorMessage("");
  }

  function handleCreate(formData: FormData) {
    setErrorMessage("");

    startTransition(async () => {
      try {
        await createCoachWorkLogs(formData);
        closeModal();
        router.refresh();
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
    });
  }

  function handleUpdate(formData: FormData) {
    setErrorMessage("");

    startTransition(async () => {
      try {
        await updateCoachWorkLog(formData);
        closeModal();
        router.refresh();
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
    });
  }

  return (
    <main className="min-h-screen bg-gray-50 p-3 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              指導者勤怠・立替管理
            </h1>
            <p className="mt-2 text-sm font-medium text-gray-700">
              カレンダーの日付をタップして、指導時間・事務作業時間・立替費用を入力します。
            </p>
          </div>

          <div className="flex gap-2">
            <a
              href="/admin"
              className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
            >
              管理者画面に戻る
            </a>
            <a
              href="/logout"
              className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
            >
              ログアウト
            </a>
          </div>
        </div>

        <section className="mt-5 rounded-lg bg-white p-4 shadow">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              {formatTargetMonth(targetMonth)}
            </h2>

            <div className="flex gap-2">
              <a
                href={`/admin/coach-work?month=${prevMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                前月
              </a>
              <a
                href={`/admin/coach-work?month=${currentMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                今月
              </a>
              <a
                href={`/admin/coach-work?month=${nextMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                翌月
              </a>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-lg bg-white p-4 shadow">
          <h2 className="text-lg font-bold text-gray-900">月間集計</h2>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {coaches.map((coach) => {
              const summary = monthlySummaryByCoach.get(coach.id);
              const coachingMinutes = summary?.coachingMinutes ?? 0;
              const adminMinutes = summary?.adminMinutes ?? 0;
              const travelExpense = summary?.travelExpense ?? 0;
              const otherExpense = summary?.otherExpense ?? 0;
              const totalExpense = travelExpense + otherExpense;

              return (
                <article
                  key={coach.id}
                  className="rounded border border-gray-300 bg-white p-3"
                >
                  <h3 className="font-bold text-gray-900">{coach.name}</h3>

                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded bg-blue-50 p-2">
                      <p className="font-bold text-blue-800">指導時間</p>
                      <p className="font-bold text-blue-900">
                        {formatMinutes(coachingMinutes)}
                      </p>
                    </div>

                    <div className="rounded bg-purple-50 p-2">
                      <p className="font-bold text-purple-800">事務作業</p>
                      <p className="font-bold text-purple-900">
                        {formatMinutes(adminMinutes)}
                      </p>
                    </div>

                    <div className="rounded bg-gray-50 p-2">
                      <p className="font-bold text-gray-800">交通費</p>
                      <p className="font-bold text-gray-900">
                        {formatYen(travelExpense)}
                      </p>
                    </div>

                    <div className="rounded bg-red-50 p-2">
                      <p className="font-bold text-red-800">立替合計</p>
                      <p className="font-bold text-red-900">
                        {formatYen(totalExpense)}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-5 overflow-hidden rounded-lg bg-gray-300 shadow">
          <div className="grid grid-cols-7 gap-px bg-gray-300">
            {weekLabels.map((label, index) => (
              <div
                key={label}
                className={
                  index === 5
                    ? "bg-blue-50 py-2 text-center text-sm font-bold text-blue-700"
                    : index === 6
                    ? "bg-red-50 py-2 text-center text-sm font-bold text-red-700"
                    : "bg-white py-2 text-center text-sm font-bold text-gray-900"
                }
              >
                {label}
              </div>
            ))}

            {cells.map((cell) => {
              const dayLogs = logsByDate.get(cell.dateKey) ?? [];
              const coachingTotal = dayLogs.reduce(
                (sum, log) => sum + log.coaching_minutes,
                0
              );
              const adminTotal = dayLogs.reduce(
                (sum, log) => sum + log.admin_minutes,
                0
              );
              const expenseTotal = dayLogs.reduce(
                (sum, log) => sum + log.travel_expense + log.other_expense,
                0
              );

              const isToday = cell.dateKey === todayKey;

              return (
                <button
                  key={cell.dateKey}
                  type="button"
                  onClick={() => {
                    setSelectedDateKey(cell.dateKey);
                    setErrorMessage("");
                  }}
                  className={
                    cell.isCurrentMonth
                      ? "min-h-28 bg-white p-1 text-left align-top"
                      : "min-h-28 bg-gray-100 p-1 text-left align-top text-gray-400"
                  }
                >
                  <div
                    className={
                      isToday
                        ? "inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-black text-sm font-bold text-gray-900"
                        : "inline-flex h-7 w-7 items-center justify-center text-sm font-bold"
                    }
                  >
                    {cell.day}
                  </div>

                  {dayLogs.length > 0 && (
                    <div className="mt-1 space-y-1 text-[10px] font-bold leading-tight">
                      <div className="rounded bg-blue-50 px-1 py-0.5 text-blue-800">
                        {dayLogs.length}件
                      </div>
                      <div className="rounded bg-gray-50 px-1 py-0.5 text-gray-800">
                        指 {formatMinutesShort(coachingTotal)}
                      </div>
                      {adminTotal > 0 && (
                        <div className="rounded bg-purple-50 px-1 py-0.5 text-purple-800">
                          事 {formatMinutesShort(adminTotal)}
                        </div>
                      )}
                      {expenseTotal > 0 && (
                        <div className="rounded bg-red-50 px-1 py-0.5 text-red-800">
                          立 {formatYen(expenseTotal)}
                        </div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {selectedDateKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <div className="max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-md overflow-x-hidden overflow-y-auto rounded-2xl bg-white p-4 text-gray-900 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {formatDate(selectedDateKey)}
                </h2>
                <p className="mt-1 text-sm font-medium text-gray-700">
                  勤怠・立替を入力します。
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="rounded bg-gray-200 px-3 py-1 font-bold text-gray-900"
              >
                ×
              </button>
            </div>

            {errorMessage && (
              <div className="mt-4 rounded bg-red-100 p-3 font-bold text-red-700">
                {errorMessage}
              </div>
            )}

            <form action={handleCreate} className="mt-5 space-y-4">
              <input type="hidden" name="work_date" value={selectedDateKey} />

              <div className="rounded border border-gray-300 bg-gray-50 p-4">
                <p className="font-bold text-gray-900">指導時間</p>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <label className="block text-sm font-bold text-gray-900">
                      時間
                    </label>
                    <input
                      name="coaching_hours"
                      type="number"
                      min={0}
                      defaultValue={0}
                      className={fieldClass}
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="block text-sm font-bold text-gray-900">
                      分
                    </label>
                    <input
                      name="coaching_minutes"
                      type="number"
                      min={0}
                      max={59}
                      defaultValue={0}
                      className={fieldClass}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded border border-gray-300 bg-gray-50 p-4">
                <p className="font-bold text-gray-900">事務作業時間</p>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <label className="block text-sm font-bold text-gray-900">
                      時間
                    </label>
                    <input
                      name="admin_hours"
                      type="number"
                      min={0}
                      defaultValue={0}
                      className={fieldClass}
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="block text-sm font-bold text-gray-900">
                      分
                    </label>
                    <input
                      name="admin_minutes"
                      type="number"
                      min={0}
                      max={59}
                      defaultValue={0}
                      className={fieldClass}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="block text-sm font-bold text-gray-900">
                    交通費
                  </label>
                  <input
                    name="travel_expense"
                    type="number"
                    min={0}
                    defaultValue={0}
                    className={fieldClass}
                  />
                </div>

                <div className="min-w-0">
                  <label className="block text-sm font-bold text-gray-900">
                    その他立替
                  </label>
                  <input
                    name="other_expense"
                    type="number"
                    min={0}
                    defaultValue={0}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  備考
                </label>
                <textarea
                  name="note"
                  className={fieldClass}
                  placeholder="例：交通費内訳、立替内容、代理入力など"
                />
              </div>

              <details className="rounded border border-gray-300 bg-gray-50 p-4">
                <summary className="cursor-pointer font-bold text-gray-900">
                  詳細設定：他の指導者も追加
                </summary>

                <div className="mt-3 grid gap-2">
                  {coaches.map((coach) => (
                    <label
                      key={coach.id}
                      className="flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-900"
                    >
                      <input
                        name="coach_ids"
                        type="checkbox"
                        value={coach.id}
                        defaultChecked={coach.id === currentAdmin.id}
                      />
                      {coach.name}
                    </label>
                  ))}
                </div>
              </details>

              <button
                disabled={isPending}
                className="w-full rounded bg-black px-4 py-3 font-bold text-white disabled:opacity-50"
              >
                保存
              </button>
            </form>

            <div className="mt-6">
              <h3 className="font-bold text-gray-900">この日の入力済み</h3>

              {selectedLogs.length === 0 ? (
                <p className="mt-2 rounded bg-gray-50 p-3 text-sm font-medium text-gray-700">
                  この日の勤怠記録はありません。
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {selectedLogs.map((log) => {
                    const coachName =
                      coachNameById.get(log.coach_id) ?? "不明な指導者";

                    const enteredByName = log.entered_by
                      ? coachNameById.get(log.entered_by) ?? "不明"
                      : "不明";

                    return (
                      <div
                        key={log.id}
                        className="rounded border border-gray-300 bg-white p-4"
                      >
                        <h4 className="text-lg font-bold text-gray-900">
                          {coachName}
                        </h4>
                        <p className="mt-1 text-sm font-medium text-gray-700">
                          入力者：{enteredByName}
                        </p>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                          <div className="rounded bg-blue-50 p-2">
                            <p className="font-bold text-blue-800">指導</p>
                            <p className="font-bold text-blue-900">
                              {formatMinutes(log.coaching_minutes)}
                            </p>
                          </div>

                          <div className="rounded bg-purple-50 p-2">
                            <p className="font-bold text-purple-800">事務</p>
                            <p className="font-bold text-purple-900">
                              {formatMinutes(log.admin_minutes)}
                            </p>
                          </div>

                          <div className="rounded bg-gray-50 p-2">
                            <p className="font-bold text-gray-800">交通費</p>
                            <p className="font-bold text-gray-900">
                              {formatYen(log.travel_expense)}
                            </p>
                          </div>

                          <div className="rounded bg-red-50 p-2">
                            <p className="font-bold text-red-800">その他</p>
                            <p className="font-bold text-red-900">
                              {formatYen(log.other_expense)}
                            </p>
                          </div>
                        </div>

                        {log.note && (
                          <p className="mt-3 rounded bg-gray-50 p-2 text-sm font-medium text-gray-800">
                            備考：{log.note}
                          </p>
                        )}

                        <details className="mt-4 rounded bg-gray-50 p-3">
                          <summary className="cursor-pointer font-bold text-gray-900">
                            この記録を修正
                          </summary>

                          <form action={handleUpdate} className="mt-3 space-y-3">
                            <input
                              type="hidden"
                              name="log_id"
                              value={log.id}
                            />

                            <input
                              type="hidden"
                              name="work_date"
                              value={selectedDateKey}
                            />

                            <div className="min-w-0">
                              <label className="block text-sm font-bold text-gray-900">
                                対象指導者
                              </label>
                              <select
                                name="coach_id"
                                defaultValue={log.coach_id}
                                className={fieldClass}
                              >
                                {coaches.map((coach) => (
                                  <option key={coach.id} value={coach.id}>
                                    {coach.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="rounded border border-gray-300 bg-white p-3">
                              <p className="font-bold text-gray-900">
                                指導時間
                              </p>

                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <input
                                  name="coaching_hours"
                                  type="number"
                                  min={0}
                                  defaultValue={getHourPart(
                                    log.coaching_minutes
                                  )}
                                  className={fieldClass}
                                />
                                <input
                                  name="coaching_minutes"
                                  type="number"
                                  min={0}
                                  max={59}
                                  defaultValue={getMinutePart(
                                    log.coaching_minutes
                                  )}
                                  className={fieldClass}
                                />
                              </div>
                            </div>

                            <div className="rounded border border-gray-300 bg-white p-3">
                              <p className="font-bold text-gray-900">
                                事務作業時間
                              </p>

                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <input
                                  name="admin_hours"
                                  type="number"
                                  min={0}
                                  defaultValue={getHourPart(log.admin_minutes)}
                                  className={fieldClass}
                                />
                                <input
                                  name="admin_minutes"
                                  type="number"
                                  min={0}
                                  max={59}
                                  defaultValue={getMinutePart(
                                    log.admin_minutes
                                  )}
                                  className={fieldClass}
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <input
                                name="travel_expense"
                                type="number"
                                min={0}
                                defaultValue={log.travel_expense}
                                className={fieldClass}
                              />
                              <input
                                name="other_expense"
                                type="number"
                                min={0}
                                defaultValue={log.other_expense}
                                className={fieldClass}
                              />
                            </div>

                            <textarea
                              name="note"
                              defaultValue={log.note ?? ""}
                              className={fieldClass}
                            />

                            <button
                              disabled={isPending}
                              className="w-full rounded bg-black px-4 py-3 font-bold text-white disabled:opacity-50"
                            >
                              修正
                            </button>
                          </form>
                        </details>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}