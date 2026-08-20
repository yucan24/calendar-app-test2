"use client";

import {
  COACH_HOURLY_RATE,
  deductionItemLabel,
  formatTaxRate,
  incomeCategoryLabel,
  type AccountingIncomeItem,
  type AccountingReportRow,
  type AccountingReportTotals,
} from "@/lib/accounting";
import { formatTargetMonth, formatYen } from "@/lib/month";

type Props = {
  targetMonth: string;
  rows: AccountingReportRow[];
  totals: AccountingReportTotals;
  incomeItems: AccountingIncomeItem[];
  cumulativeBalance: number;
};

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  if (hours === 0 && minutes === 0) return "0時間";
  if (minutes === 0) return `${hours}時間`;
  if (hours === 0) return `${minutes}分`;

  return `${hours}時間${minutes}分`;
}

function formatHoursShort(value: number) {
  const hours = value / 60;

  if (hours === 0) return "0h";

  const rounded = Math.round(hours * 100) / 100;

  if (Number.isInteger(rounded)) {
    return `${rounded}h`;
  }

  return `${rounded}h`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function balanceLabel(value: number) {
  if (value > 0) return "黒字";
  if (value < 0) return "赤字";
  return "収支ゼロ";
}

function balanceClass(value: number) {
  if (value > 0) return "bg-green-50 text-green-800";
  if (value < 0) return "bg-red-50 text-red-800";
  return "bg-gray-100 text-gray-800";
}

function balanceTextClass(value: number) {
  if (value > 0) return "text-green-700";
  if (value < 0) return "text-red-700";
  return "text-gray-800";
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
) {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  let line = "";

  for (const char of Array.from(normalizedText)) {
    const nextLine = `${line}${char}`;

    if (line && ctx.measureText(nextLine).width > maxWidth) {
      lines.push(line);
      line = char;

      if (lines.length === maxLines) break;
    } else {
      line = nextLine;
    }
  }

  if (line && lines.length < maxLines) {
    lines.push(line);
  }

  if (lines.length === maxLines && ctx.measureText(line).width > maxWidth) {
    const lastIndex = lines.length - 1;
    let truncated = lines[lastIndex];

    while (
      truncated.length > 0 &&
      ctx.measureText(`${truncated}...`).width > maxWidth
    ) {
      truncated = truncated.slice(0, -1);
    }

    lines[lastIndex] = `${truncated}...`;
  }

  return lines.length > 0 ? lines : [""];
}

function drawText(input: {
  ctx: CanvasRenderingContext2D;
  text: string;
  x: number;
  y: number;
  maxWidth?: number;
  font: string;
  color?: string;
  align?: CanvasTextAlign;
}) {
  input.ctx.font = input.font;
  input.ctx.fillStyle = input.color ?? "#111827";
  input.ctx.textAlign = input.align ?? "left";
  input.ctx.textBaseline = "top";
  input.ctx.fillText(input.text, input.x, input.y, input.maxWidth);
}

function drawWrappedText(input: {
  ctx: CanvasRenderingContext2D;
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  lineHeight: number;
  maxLines: number;
  font: string;
  color?: string;
}) {
  input.ctx.font = input.font;
  input.ctx.fillStyle = input.color ?? "#111827";
  input.ctx.textAlign = "left";
  input.ctx.textBaseline = "top";

  const lines = wrapCanvasText(
    input.ctx,
    input.text,
    input.maxWidth,
    input.maxLines
  );

  lines.forEach((line, index) => {
    input.ctx.fillText(line, input.x, input.y + index * input.lineHeight);
  });
}

function fillPanel(input: {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke?: string;
}) {
  input.ctx.fillStyle = input.fill;
  input.ctx.fillRect(input.x, input.y, input.width, input.height);

  if (input.stroke) {
    input.ctx.strokeStyle = input.stroke;
    input.ctx.lineWidth = 1;
    input.ctx.strokeRect(input.x, input.y, input.width, input.height);
  }
}

function createReportImageDataUrl(input: Props) {
  const width = 1280;
  const padding = 48;
  const summaryTop = 126;
  const summaryHeight = 88;
  const incomeTop = 236;
  const tableTop = 332;
  const headerHeight = 40;
  const footerHeight = 84;
  const rowHeights = input.rows.map((row) =>
    Math.max(76, 56 + Math.max(1, row.deductionItems.length) * 18)
  );
  const rowsHeight = rowHeights.reduce((sum, height) => sum + height, 0);
  const incomeHeight =
    input.incomeItems.length > 0
      ? Math.min(80, 22 + input.incomeItems.length * 18)
      : 34;
  const height =
    tableTop + headerHeight + rowsHeight + incomeHeight + footerHeight;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("画像の作成に失敗しました");
  }

  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(scale, scale);

  fillPanel({ ctx, x: 0, y: 0, width, height, fill: "#f8fafc" });

  drawText({
    ctx,
    text: `${formatTargetMonth(input.targetMonth)} 会計レポート`,
    x: padding,
    y: 42,
    font:
      '700 34px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
  });

  drawText({
    ctx,
    text: `報酬単価 ${formatYen(
      COACH_HOURLY_RATE
    )} / 時間  ・  源泉税率 ${formatTaxRate()}  ・  累計収支 ${formatYen(
      input.cumulativeBalance
    )}`,
    x: padding,
    y: 88,
    font:
      '500 18px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
    color: "#4b5563",
  });

  const summaryGap = 16;
  const summaryWidth = (width - padding * 2 - summaryGap * 3) / 4;
  const summaries = [
    {
      label: "月次収支",
      value: formatYen(input.totals.balance),
      sub: balanceLabel(input.totals.balance),
      fill:
        input.totals.balance > 0
          ? "#ecfdf5"
          : input.totals.balance < 0
            ? "#fef2f2"
            : "#f3f4f6",
      color:
        input.totals.balance > 0
          ? "#047857"
          : input.totals.balance < 0
            ? "#b91c1c"
            : "#374151",
    },
    {
      label: "収入",
      value: formatYen(input.totals.incomeTotal),
      sub: "月謝 + 協賛金等",
      fill: "#ecfdf5",
      color: "#047857",
    },
    {
      label: "指導者振込",
      value: formatYen(input.totals.netPayTotal),
      sub: "手取り合計",
      fill: "#eff6ff",
      color: "#1d4ed8",
    },
    {
      label: "税務署納税",
      value: formatYen(input.totals.withholdingTaxTotal),
      sub: "源泉税合計",
      fill: "#fff7ed",
      color: "#c2410c",
    },
  ];

  summaries.forEach((summary, index) => {
    const x = padding + index * (summaryWidth + summaryGap);

    fillPanel({
      ctx,
      x,
      y: summaryTop,
      width: summaryWidth,
      height: summaryHeight,
      fill: summary.fill,
      stroke: "#e5e7eb",
    });

    drawText({
      ctx,
      text: summary.label,
      x: x + 18,
      y: summaryTop + 14,
      font:
        '700 16px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
      color: "#374151",
    });

    drawText({
      ctx,
      text: summary.value,
      x: x + 18,
      y: summaryTop + 38,
      font:
        '700 25px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
      color: summary.color,
      maxWidth: summaryWidth - 36,
    });

    drawText({
      ctx,
      text: summary.sub,
      x: x + 18,
      y: summaryTop + 68,
      font:
        '500 13px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
      color: "#6b7280",
    });
  });

  drawText({
    ctx,
    text: `月謝 ${formatYen(
      input.totals.paidTuitionTotal
    )} / 協賛金 ${formatYen(
      input.totals.sponsorshipTotal
    )} / その他収入 ${formatYen(
      input.totals.otherIncomeTotal
    )} / 未払い控除 ${formatYen(input.totals.unpaidDeductionTotal)}`,
    x: padding,
    y: incomeTop,
    font:
      '600 17px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
    color: "#374151",
  });

  const incomeText =
    input.incomeItems.length === 0
      ? "登録された協賛金・その他収入はありません"
      : input.incomeItems
          .slice(0, 3)
          .map(
            (item) =>
              `${formatDate(item.received_on)} ${incomeCategoryLabel(
                item.category
              )} ${item.payer_name} ${formatYen(item.amount)}`
          )
          .join(" / ");

  drawWrappedText({
    ctx,
    text:
      input.incomeItems.length > 3
        ? `${incomeText} / 他 ${input.incomeItems.length - 3} 件`
        : incomeText,
    x: padding,
    y: incomeTop + 32,
    maxWidth: width - padding * 2,
    lineHeight: 18,
    maxLines: 2,
    font:
      '500 14px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
    color: "#6b7280",
  });

  const columns = [
    { label: "指導者", x: 48, width: 150, align: "left" as const },
    { label: "勤務", x: 198, width: 136, align: "left" as const },
    { label: "報酬", x: 334, width: 126, align: "right" as const },
    { label: "源泉税", x: 460, width: 124, align: "right" as const },
    { label: "未払い控除内訳", x: 584, width: 304, align: "left" as const },
    { label: "立替", x: 888, width: 116, align: "right" as const },
    { label: "手取り", x: 1004, width: 228, align: "right" as const },
  ];

  fillPanel({
    ctx,
    x: padding,
    y: tableTop,
    width: width - padding * 2,
    height: headerHeight,
    fill: "#111827",
  });

  columns.forEach((column) => {
    drawText({
      ctx,
      text: column.label,
      x:
        column.align === "right"
          ? column.x + column.width - 12
          : column.x + 12,
      y: tableTop + 11,
      font:
        '700 15px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
      color: "#ffffff",
      align: column.align,
    });
  });

  let rowTop = tableTop + headerHeight;

  input.rows.forEach((row, index) => {
    const rowHeight = rowHeights[index];
    const deductionLines =
      row.deductionItems.length > 0
        ? row.deductionItems.map(
            (item) =>
              `${deductionItemLabel(item)} ${formatYen(item.amount)}`
          )
        : ["なし"];

    fillPanel({
      ctx,
      x: padding,
      y: rowTop,
      width: width - padding * 2,
      height: rowHeight,
      fill: index % 2 === 0 ? "#ffffff" : "#f9fafb",
      stroke: "#e5e7eb",
    });

    drawWrappedText({
      ctx,
      text: row.coachName,
      x: columns[0].x + 12,
      y: rowTop + 16,
      maxWidth: columns[0].width - 24,
      lineHeight: 18,
      maxLines: 2,
      font:
        '700 16px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
    });

    drawText({
      ctx,
      text: `計 ${formatHoursShort(row.totalWorkMinutes)}`,
      x: columns[1].x + 12,
      y: rowTop + 14,
      font:
        '700 16px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
    });

    drawText({
      ctx,
      text: `指 ${formatHoursShort(row.coachingMinutes)} / 事 ${formatHoursShort(
        row.adminMinutes
      )}`,
      x: columns[1].x + 12,
      y: rowTop + 39,
      font:
        '500 13px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
      color: "#6b7280",
    });

    [
      { value: row.grossReward, column: columns[2], color: "#111827" },
      { value: row.withholdingTax, column: columns[3], color: "#c2410c" },
      { value: row.reimbursedExpense, column: columns[5], color: "#374151" },
      { value: row.netPay, column: columns[6], color: "#1d4ed8" },
    ].forEach((cell) => {
      drawText({
        ctx,
        text: formatYen(cell.value),
        x: cell.column.x + cell.column.width - 12,
        y: rowTop + 24,
        font:
          '700 16px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
        color: cell.color,
        align: "right",
      });
    });

    deductionLines.slice(0, 4).forEach((line, lineIndex) => {
      drawWrappedText({
        ctx,
        text: line,
        x: columns[4].x + 12,
        y: rowTop + 13 + lineIndex * 18,
        maxWidth: columns[4].width - 24,
        lineHeight: 16,
        maxLines: 1,
        font:
          line === "なし"
            ? '500 13px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif'
            : '600 13px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
        color: line === "なし" ? "#6b7280" : "#92400e",
      });
    });

    if (deductionLines.length > 4) {
      drawText({
        ctx,
        text: `他 ${deductionLines.length - 4} 件`,
        x: columns[4].x + 12,
        y: rowTop + 13 + 4 * 18,
        font:
          '500 13px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
        color: "#92400e",
      });
    }

    rowTop += rowHeight;
  });

  const footerTop = rowTop + 24;

  drawText({
    ctx,
    text: `計算式：報酬 =（指導時間 + 事務作業時間）× 時給、源泉税 = 報酬 × ${formatTaxRate()}、手取り = 報酬 - 源泉税 + 立替 - 未払い控除`,
    x: padding,
    y: footerTop,
    font:
      '500 15px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
    color: "#4b5563",
    maxWidth: width - padding * 2,
  });

  drawText({
    ctx,
    text: `作成日時：${new Intl.DateTimeFormat("ja-JP", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tokyo",
    }).format(new Date())}`,
    x: padding,
    y: footerTop + 28,
    font:
      '500 13px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif',
    color: "#6b7280",
  });

  return canvas.toDataURL("image/png");
}

export default function AccountingReportClient({
  targetMonth,
  rows,
  totals,
  incomeItems,
  cumulativeBalance,
}: Props) {
  const summaryCards = [
    {
      label: "月次収支",
      value: formatYen(totals.balance),
      sub: balanceLabel(totals.balance),
      className: balanceClass(totals.balance),
    },
    {
      label: "収入合計",
      value: formatYen(totals.incomeTotal),
      sub: "月謝 + 協賛金等",
      className: "bg-green-50 text-green-800",
    },
    {
      label: "月謝収入",
      value: formatYen(totals.paidTuitionTotal),
      sub: "支払い済み月謝",
      className: "bg-emerald-50 text-emerald-800",
    },
    {
      label: "協賛金",
      value: formatYen(totals.sponsorshipTotal),
      sub: `${incomeItems.filter((item) => item.category === "sponsorship").length}件`,
      className: "bg-cyan-50 text-cyan-800",
    },
    {
      label: "指導者振込",
      value: formatYen(totals.netPayTotal),
      sub: "手取り合計",
      className: "bg-blue-50 text-blue-800",
    },
    {
      label: "税務署納税",
      value: formatYen(totals.withholdingTaxTotal),
      sub: `源泉税 ${formatTaxRate()}`,
      className: "bg-orange-50 text-orange-800",
    },
    {
      label: "未払い控除",
      value: formatYen(totals.unpaidDeductionTotal),
      sub: "指導者手取りから控除",
      className: "bg-yellow-50 text-yellow-800",
    },
    {
      label: "未収残",
      value: formatYen(totals.remainingUnpaidChargeTotal),
      sub: "控除後の未払い",
      className: "bg-red-50 text-red-800",
    },
  ];

  function downloadReportImage() {
    const dataUrl = createReportImageDataUrl({
      targetMonth,
      rows,
      totals,
      incomeItems,
      cumulativeBalance,
    });
    const link = document.createElement("a");

    link.href = dataUrl;
    link.download = `accounting-report-${targetMonth}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <section className="mt-6 rounded-lg bg-white p-5 shadow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">月次会計レポート</h2>
          <p className="mt-1 text-sm font-medium text-gray-700">
            時給 {formatYen(COACH_HOURLY_RATE)} / 源泉税 {formatTaxRate()}
          </p>
          <p
            className={`mt-2 inline-flex rounded px-2 py-1 text-xs font-bold ${balanceClass(
              cumulativeBalance
            )}`}
          >
            累計収支（選択月まで） {formatYen(cumulativeBalance)}
          </p>
        </div>

        <button
          type="button"
          onClick={downloadReportImage}
          className="rounded bg-black px-4 py-3 font-bold text-white"
        >
          共有画像を保存
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <div key={card.label} className={`rounded p-3 ${card.className}`}>
            <p className="text-sm font-bold">{card.label}</p>
            <p className="mt-1 text-2xl font-bold">{card.value}</p>
            <p className="mt-1 text-xs font-bold opacity-80">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded bg-gray-50 p-3">
          <p className="font-bold text-gray-800">報酬総額</p>
          <p className="mt-1 font-bold text-gray-900">
            {formatYen(totals.grossRewardTotal)}
          </p>
        </div>

        <div className="rounded bg-gray-50 p-3">
          <p className="font-bold text-gray-800">立替精算</p>
          <p className="mt-1 font-bold text-gray-900">
            {formatYen(totals.reimbursedExpenseTotal)}
          </p>
        </div>

        <div className="rounded bg-gray-50 p-3">
          <p className="font-bold text-gray-800">未清算返金</p>
          <p className="mt-1 font-bold text-gray-900">
            {formatYen(totals.unsettledRefundTotal)}
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs font-medium text-gray-600">
        収入は支払い済み月謝、協賛金・その他収入、未払い控除分を合算します。
        支出は指導者報酬、立替精算、清算済み返金を合算します。
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="bg-gray-900 text-left text-white">
              <th className="px-3 py-3 font-bold">指導者</th>
              <th className="px-3 py-3 font-bold">勤務時間</th>
              <th className="px-3 py-3 text-right font-bold">報酬</th>
              <th className="px-3 py-3 text-right font-bold">源泉税</th>
              <th className="px-3 py-3 font-bold">未払い控除</th>
              <th className="px-3 py-3 text-right font-bold">立替</th>
              <th className="px-3 py-3 text-right font-bold">手取り</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.coachId} className="border-b border-gray-200">
                <td className="px-3 py-3 align-top font-bold text-gray-900">
                  {row.coachName}
                </td>
                <td className="px-3 py-3 align-top">
                  <p className="font-bold text-gray-900">
                    {formatMinutes(row.totalWorkMinutes)}
                  </p>
                  <p className="mt-1 text-xs font-medium text-gray-600">
                    指導 {formatMinutes(row.coachingMinutes)} / 事務{" "}
                    {formatMinutes(row.adminMinutes)}
                  </p>
                </td>
                <td className="px-3 py-3 text-right align-top font-bold text-gray-900">
                  {formatYen(row.grossReward)}
                </td>
                <td className="px-3 py-3 text-right align-top font-bold text-orange-700">
                  {formatYen(row.taxOfficePayment)}
                </td>
                <td className="px-3 py-3 align-top">
                  <p className="font-bold text-yellow-800">
                    {formatYen(row.unpaidDeductionTotal)}
                  </p>

                  {row.deductionItems.length === 0 ? (
                    <p className="mt-1 text-xs font-medium text-gray-600">
                      内訳なし
                    </p>
                  ) : (
                    <div className="mt-1 space-y-1">
                      {row.deductionItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between gap-3 rounded bg-yellow-50 px-2 py-1 text-xs"
                        >
                          <span className="font-medium text-gray-900">
                            {deductionItemLabel(item)}
                          </span>
                          <span className="shrink-0 font-bold text-yellow-800">
                            {formatYen(item.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-right align-top font-bold text-gray-900">
                  {formatYen(row.reimbursedExpense)}
                </td>
                <td
                  className={`px-3 py-3 text-right align-top font-bold ${balanceTextClass(
                    row.netPay
                  )}`}
                >
                  {formatYen(row.netPay)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
