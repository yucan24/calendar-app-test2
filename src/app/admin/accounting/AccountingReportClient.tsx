"use client";

import { useState } from "react";
import {
  COACH_HOURLY_RATE,
  deductionItemLabel,
  formatTaxRate,
  type AccountingExpenseItem,
  type AccountingIncomeItem,
  type AccountingReportRow,
  type AccountingReportTotals,
  type AccountingRewardAdjustment,
} from "@/lib/accounting";
import { formatTargetMonth, formatYen } from "@/lib/month";

type Props = {
  targetMonth: string;
  rows: AccountingReportRow[];
  totals: AccountingReportTotals;
  incomeItems: AccountingIncomeItem[];
  expenseItems: AccountingExpenseItem[];
  cumulativeBalance: number;
};

type BreakdownRow = {
  label: string;
  note: string;
  amount: number;
  details?: BreakdownDetail[];
};

type BreakdownDetail = {
  id: string;
  label: string;
  note?: string;
  amount: number;
};

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  if (hours === 0 && minutes === 0) return "0時間";
  if (minutes === 0) return `${hours}時間`;
  if (hours === 0) return `${minutes}分`;

  return `${hours}時間${minutes}分`;
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

function formatRewardAdjustmentPeriod(adjustment: AccountingRewardAdjustment) {
  const start = formatDate(adjustment.starts_on);
  const end = adjustment.ends_on ? formatDate(adjustment.ends_on) : "終了日なし";

  return `${start}〜${end}`;
}

function sortIncomeItems(items: AccountingIncomeItem[]) {
  return [...items].sort(
    (a, b) =>
      a.received_on.localeCompare(b.received_on) ||
      a.payer_name.localeCompare(b.payer_name)
  );
}

function sortExpenseItems(items: AccountingExpenseItem[]) {
  return [...items].sort(
    (a, b) =>
      a.spent_on.localeCompare(b.spent_on) ||
      a.payee_name.localeCompare(b.payee_name)
  );
}

function incomeItemToDetail(item: AccountingIncomeItem): BreakdownDetail {
  return {
    id: item.id,
    label: `${formatDate(item.received_on)} ${item.payer_name}`,
    note: item.note ?? undefined,
    amount: item.amount,
  };
}

function expenseItemToDetail(item: AccountingExpenseItem): BreakdownDetail {
  return {
    id: item.id,
    label: `${formatDate(item.spent_on)} ${item.payee_name}`,
    note: item.note ?? undefined,
    amount: item.amount,
  };
}

function getIncomeBreakdownRows(
  totals: AccountingReportTotals,
  incomeItems: AccountingIncomeItem[]
): BreakdownRow[] {
  const sponsorshipItems = sortIncomeItems(
    incomeItems.filter((item) => item.category === "sponsorship")
  );
  const otherIncomeItems = sortIncomeItems(
    incomeItems.filter((item) => item.category !== "sponsorship")
  );
  const sponsorshipDetails = sponsorshipItems.map(incomeItemToDetail);
  const otherIncomeDetails = otherIncomeItems.map(incomeItemToDetail);

  return [
    {
      label: "支払い済み月謝",
      note: "保護者から入金済み",
      amount: totals.paidTuitionTotal,
    },
    {
      label: "協賛金",
      note: sponsorshipDetails.length > 0 ? "個別入金" : "該当なし",
      amount: totals.sponsorshipTotal,
      details: sponsorshipDetails,
    },
    {
      label: "その他収入",
      note: otherIncomeDetails.length > 0 ? "個別入金" : "該当なし",
      amount: totals.otherIncomeTotal,
      details: otherIncomeDetails,
    },
  ];
}

function getExpenseBreakdownRows(
  totals: AccountingReportTotals,
  expenseItems: AccountingExpenseItem[]
): BreakdownRow[] {
  const expenseDetails = sortExpenseItems(expenseItems).map(expenseItemToDetail);

  return [
    {
      label: "指導者報酬",
      note: "報酬 - 源泉税",
      amount: totals.netPayBeforeDeductionTotal,
    },
    {
      label: "源泉税納税",
      note: `支給報酬 ${formatYen(totals.grossRewardTotal)} × ${formatTaxRate()}`,
      amount: totals.withholdingTaxTotal,
    },
    {
      label: "その他出費",
      note: expenseDetails.length > 0 ? "個別出費" : "該当なし",
      amount: totals.expenseItemsTotal,
      details: expenseDetails,
    },
  ];
}

function getBreakdownRowHeight(row: BreakdownRow) {
  return 58 + (row.details?.length ?? 0) * 24;
}

/*
  The old report only showed counts for manual income/expense rows.
  Keep each item visible in both the page and exported image.
*/
function getBreakdownDetailsHeight(rows: BreakdownRow[]) {
  return rows.reduce((sum, row) => sum + getBreakdownRowHeight(row), 0);
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

  if (lines.length === maxLines && line) {
    const lastIndex = lines.length - 1;
    let truncated = lines[lastIndex];

    while (
      truncated.length > 0 &&
      ctx.measureText(`${truncated}...`).width > maxWidth
    ) {
      truncated = truncated.slice(0, -1);
    }

    if (truncated !== lines[lastIndex]) {
      lines[lastIndex] = `${truncated}...`;
    }
  }

  return lines.length > 0 ? lines : [""];
}

function drawText(input: {
  ctx: CanvasRenderingContext2D;
  text: string;
  x: number;
  y: number;
  font: string;
  color?: string;
  align?: CanvasTextAlign;
  maxWidth?: number;
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

function drawLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  color = "#d1d5db"
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.stroke();
}

function createReportImageDataUrl(input: Props) {
  const width = 1280;
  const padding = 48;
  const contentWidth = width - padding * 2;
  const fontFamily =
    '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif';
  const incomeRows = getIncomeBreakdownRows(input.totals, input.incomeItems);
  const expenseRows = getExpenseBreakdownRows(input.totals, input.expenseItems);
  const coachRowHeights = input.rows.map((row) => {
    const rewardHeight =
      row.rewardCutTotal > 0 || row.rewardAdjustments.length > 0
        ? 104 + row.rewardAdjustments.length * 16
        : 84;
    const deductionHeight =
      row.unpaidDeductionTotal > 0 ? 98 + row.deductionItems.length * 30 : 84;

    return Math.max(84, rewardHeight, deductionHeight);
  });
  const coachTableHeight =
    58 + coachRowHeights.reduce((sum, height) => sum + height, 0);
  const breakdownHeight =
    42 +
    Math.max(
      getBreakdownDetailsHeight(incomeRows),
      getBreakdownDetailsHeight(expenseRows)
    ) +
    48;
  const height =
    48 +
    78 +
    138 +
    38 +
    78 +
    coachTableHeight +
    48 +
    breakdownHeight +
    48;
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

  fillPanel({ ctx, x: 0, y: 0, width, height, fill: "#ffffff" });

  let y = 48;

  drawText({
    ctx,
    text: "会計報告書",
    x: padding,
    y,
    font: `700 16px ${fontFamily}`,
    color: "#4b5563",
  });
  drawText({
    ctx,
    text: formatTargetMonth(input.targetMonth),
    x: padding,
    y: y + 24,
    font: `700 34px ${fontFamily}`,
  });
  drawText({
    ctx,
    text: `指導者別時給（未設定 ${formatYen(
      COACH_HOURLY_RATE
    )} / 時間）、源泉税率 ${formatTaxRate()}（支給報酬のみ）`,
    x: padding,
    y: y + 66,
    font: `500 16px ${fontFamily}`,
    color: "#374151",
  });

  y += 112;

  const summaryHeight = 116;
  const summaryWidth = contentWidth / 3;
  const summaryItems = [
    {
      label: "A. 収入合計",
      value: formatYen(input.totals.incomeTotal),
      note: "月謝、協賛金、その他収入",
      fill: "#ffffff",
      color: "#047857",
    },
    {
      label: "B. 支出合計",
      value: formatYen(input.totals.expenseTotal),
      note: "指導者報酬、源泉税、その他出費",
      fill: "#ffffff",
      color: "#111827",
    },
    {
      label: "C. 月次収支",
      value: formatYen(input.totals.balance),
      note: balanceLabel(input.totals.balance),
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
  ];

  fillPanel({
    ctx,
    x: padding,
    y,
    width: contentWidth,
    height: summaryHeight,
    fill: "#ffffff",
    stroke: "#d1d5db",
  });

  summaryItems.forEach((item, index) => {
    const x = padding + summaryWidth * index;

    fillPanel({
      ctx,
      x,
      y,
      width: summaryWidth,
      height: summaryHeight,
      fill: item.fill,
    });

    if (index > 0) {
      ctx.strokeStyle = "#d1d5db";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + summaryHeight);
      ctx.stroke();
    }

    drawText({
      ctx,
      text: item.label,
      x: x + 22,
      y: y + 18,
      font: `700 16px ${fontFamily}`,
      color: "#4b5563",
    });
    drawText({
      ctx,
      text: item.value,
      x: x + 22,
      y: y + 45,
      font: `700 30px ${fontFamily}`,
      color: item.color,
      maxWidth: summaryWidth - 44,
    });
    drawText({
      ctx,
      text: item.note,
      x: x + 22,
      y: y + 84,
      font: `600 13px ${fontFamily}`,
      color: "#4b5563",
      maxWidth: summaryWidth - 44,
    });
  });

  y += summaryHeight;

  fillPanel({
    ctx,
    x: padding,
    y,
    width: contentWidth,
    height: 38,
    fill: "#ffffff",
    stroke: "#d1d5db",
  });
  drawText({
    ctx,
    text: `${formatYen(input.totals.incomeTotal)} - ${formatYen(
      input.totals.expenseTotal
    )} = ${formatYen(input.totals.balance)}    累計収支（選択月まで） ${formatYen(
      input.cumulativeBalance
    )}`,
    x: padding + 16,
    y: y + 10,
    font: `700 14px ${fontFamily}`,
    color: "#1f2937",
  });

  y += 70;

  drawText({
    ctx,
    text: "指導者別 報酬一覧",
    x: padding,
    y,
    font: `700 22px ${fontFamily}`,
  });
  drawText({
    ctx,
    text: "報酬、源泉税、未払い控除後の手取りを確認する一覧です。",
    x: padding,
    y: y + 32,
    font: `500 14px ${fontFamily}`,
    color: "#4b5563",
  });
  y += 64;
  drawLine(ctx, padding, y, contentWidth);
  y += 1;

  const columns = [
    { label: "指導者", x: padding, width: 170, align: "left" as const },
    { label: "勤務", x: padding + 170, width: 170, align: "left" as const },
    { label: "報酬", x: padding + 340, width: 260, align: "right" as const },
    { label: "源泉税", x: padding + 600, width: 170, align: "right" as const },
    { label: "手取り", x: padding + 770, width: 414, align: "right" as const },
  ];

  columns.forEach((column) => {
    drawText({
      ctx,
      text: column.label,
      x:
        column.align === "right"
          ? column.x + column.width - 14
          : column.x + 14,
      y: y + 16,
      font: `700 13px ${fontFamily}`,
      color: "#4b5563",
      align: column.align,
    });
  });

  y += 58;

  input.rows.forEach((row, index) => {
    const rowHeight = coachRowHeights[index];
    const rowTop = y;

    fillPanel({
      ctx,
      x: padding,
      y: rowTop,
      width: contentWidth,
      height: rowHeight,
      fill: index % 2 === 0 ? "#ffffff" : "#f9fafb",
    });
    drawLine(ctx, padding, rowTop + rowHeight, contentWidth, "#e5e7eb");

    drawWrappedText({
      ctx,
      text: row.coachName,
      x: columns[0].x + 14,
      y: rowTop + 18,
      maxWidth: columns[0].width - 28,
      lineHeight: 18,
      maxLines: 2,
      font: `700 16px ${fontFamily}`,
    });

    drawText({
      ctx,
      text: formatMinutes(row.totalWorkMinutes),
      x: columns[1].x + 14,
      y: rowTop + 16,
      font: `700 15px ${fontFamily}`,
    });
    drawWrappedText({
      ctx,
      text: `指導 ${formatMinutes(row.coachingMinutes)} / 事務 ${formatMinutes(
        row.adminMinutes
      )}`,
      x: columns[1].x + 14,
      y: rowTop + 40,
      maxWidth: columns[1].width - 28,
      lineHeight: 16,
      maxLines: 2,
      font: `500 12px ${fontFamily}`,
      color: "#4b5563",
    });

    drawText({
      ctx,
      text: formatYen(row.grossReward),
      x: columns[2].x + columns[2].width - 14,
      y: rowTop + 16,
      font: `700 16px ${fontFamily}`,
      align: "right",
    });
    drawText({
      ctx,
      text: "時給",
      x: columns[2].x + 60,
      y: rowTop + 40,
      font: `500 12px ${fontFamily}`,
      color: "#4b5563",
    });
    drawText({
      ctx,
      text: formatYen(row.hourlyRate),
      x: columns[2].x + columns[2].width - 14,
      y: rowTop + 40,
      font: `500 12px ${fontFamily}`,
      color: "#4b5563",
      align: "right",
    });
    drawText({
      ctx,
      text: "基本",
      x: columns[2].x + 60,
      y: rowTop + 56,
      font: `500 12px ${fontFamily}`,
      color: "#4b5563",
    });
    drawText({
      ctx,
      text: formatYen(row.baseReward),
      x: columns[2].x + columns[2].width - 14,
      y: rowTop + 56,
      font: `500 12px ${fontFamily}`,
      color: "#4b5563",
      align: "right",
    });
    const adjustmentDetailsY = rowTop + (row.rewardCutTotal > 0 ? 90 : 72);
    if (row.rewardCutTotal > 0) {
      drawText({
        ctx,
        text: "報酬調整",
        x: columns[2].x + 60,
        y: rowTop + 72,
        font: `500 12px ${fontFamily}`,
        color: "#b91c1c",
      });
      drawText({
        ctx,
        text: `-${formatYen(row.rewardCutTotal)}`,
        x: columns[2].x + columns[2].width - 14,
        y: rowTop + 72,
        font: `700 12px ${fontFamily}`,
        color: "#b91c1c",
        align: "right",
      });
    }
    row.rewardAdjustments.slice(0, 2).forEach((adjustment, adjustmentIndex) => {
      drawText({
        ctx,
        text: `${adjustment.pay_rate_percent}% ${formatRewardAdjustmentPeriod(
          adjustment
        )}`,
        x: columns[2].x + 14,
        y: adjustmentDetailsY + adjustmentIndex * 16,
        font: `500 12px ${fontFamily}`,
        color: "#b91c1c",
        maxWidth: columns[2].width - 28,
      });
    });

    drawText({
      ctx,
      text: formatYen(row.taxOfficePayment),
      x: columns[3].x + columns[3].width - 14,
      y: rowTop + 16,
      font: `700 16px ${fontFamily}`,
      color: "#c2410c",
      align: "right",
    });

    drawText({
      ctx,
      text: formatYen(row.netPay),
      x: columns[4].x + columns[4].width - 14,
      y: rowTop + 16,
      font: `700 20px ${fontFamily}`,
      color:
        row.netPay > 0 ? "#047857" : row.netPay < 0 ? "#b91c1c" : "#374151",
      align: "right",
    });

    if (row.unpaidDeductionTotal > 0) {
      const deductionBoxX = columns[4].x + 92;
      const deductionBoxY = rowTop + 42;
      const deductionBoxWidth = columns[4].width - 106;
      const deductionBoxHeight = 42 + row.deductionItems.length * 30;

      fillPanel({
        ctx,
        x: deductionBoxX,
        y: deductionBoxY,
        width: deductionBoxWidth,
        height: deductionBoxHeight,
        fill: "#fef2f2",
        stroke: "#fecaca",
      });

      drawText({
        ctx,
        text: "控除前",
        x: deductionBoxX + 12,
        y: deductionBoxY + 9,
        font: `500 12px ${fontFamily}`,
        color: "#991b1b",
      });
      drawText({
        ctx,
        text: formatYen(row.netPayBeforeDeduction),
        x: deductionBoxX + deductionBoxWidth - 12,
        y: deductionBoxY + 9,
        font: `500 12px ${fontFamily}`,
        color: "#b91c1c",
        align: "right",
      });
      drawText({
        ctx,
        text: "未払い控除",
        x: deductionBoxX + 12,
        y: deductionBoxY + 26,
        font: `500 12px ${fontFamily}`,
        color: "#991b1b",
      });
      drawText({
        ctx,
        text: `-${formatYen(row.unpaidDeductionTotal)}`,
        x: deductionBoxX + deductionBoxWidth - 12,
        y: deductionBoxY + 26,
        font: `700 12px ${fontFamily}`,
        color: "#b91c1c",
        align: "right",
      });

      row.deductionItems.forEach((item, deductionIndex) => {
        const itemY = deductionBoxY + 48 + deductionIndex * 30;

        drawWrappedText({
          ctx,
          text: deductionItemLabel(item),
          x: deductionBoxX + 12,
          y: itemY,
          maxWidth: deductionBoxWidth - 112,
          lineHeight: 14,
          maxLines: 2,
          font: `500 12px ${fontFamily}`,
          color: "#7f1d1d",
        });
        drawText({
          ctx,
          text: `-${formatYen(item.amount)}`,
          x: deductionBoxX + deductionBoxWidth - 12,
          y: itemY,
          font: `700 12px ${fontFamily}`,
          color: "#b91c1c",
          align: "right",
        });
      });
    }

    y += rowHeight;
  });

  y += 44;

  const breakdownGap = 32;
  const breakdownWidth = (contentWidth - breakdownGap) / 2;
  const reportContext = ctx;

  function drawBreakdownTable(inputTable: {
    title: string;
    rows: BreakdownRow[];
    totalLabel: string;
    totalAmount: number;
    x: number;
    amountColor: string;
  }) {
    drawText({
      ctx: reportContext,
      text: inputTable.title,
      x: inputTable.x,
      y,
      font: `700 19px ${fontFamily}`,
    });
    drawLine(reportContext, inputTable.x, y + 34, breakdownWidth);

    let rowTop = y + 36;

    inputTable.rows.forEach((row) => {
      const rowHeight = getBreakdownRowHeight(row);

      drawText({
        ctx: reportContext,
        text: row.label,
        x: inputTable.x,
        y: rowTop + 10,
        font: `700 14px ${fontFamily}`,
      });
      drawText({
        ctx: reportContext,
        text: row.note,
        x: inputTable.x,
        y: rowTop + 31,
        font: `500 12px ${fontFamily}`,
        color: "#4b5563",
        maxWidth: breakdownWidth - 180,
      });
      drawText({
        ctx: reportContext,
        text: formatYen(row.amount),
        x: inputTable.x + breakdownWidth,
        y: rowTop + 18,
        font: `700 15px ${fontFamily}`,
        color: inputTable.amountColor,
        align: "right",
      });

      row.details?.forEach((detail, detailIndex) => {
        const detailY = rowTop + 52 + detailIndex * 24;

        drawWrappedText({
          ctx: reportContext,
          text: detail.label,
          x: inputTable.x + 12,
          y: detailY,
          maxWidth: breakdownWidth - 190,
          lineHeight: 14,
          maxLines: 1,
          font: `500 12px ${fontFamily}`,
          color: "#374151",
        });
        drawText({
          ctx: reportContext,
          text: formatYen(detail.amount),
          x: inputTable.x + breakdownWidth,
          y: detailY,
          font: `700 12px ${fontFamily}`,
          color: inputTable.amountColor,
          align: "right",
        });
      });

      drawLine(
        reportContext,
        inputTable.x,
        rowTop + rowHeight,
        breakdownWidth,
        "#e5e7eb"
      );

      rowTop += rowHeight;
    });

    const totalTop = rowTop;

    drawText({
      ctx: reportContext,
      text: inputTable.totalLabel,
      x: inputTable.x,
      y: totalTop + 14,
      font: `700 16px ${fontFamily}`,
    });
    drawText({
      ctx: reportContext,
      text: formatYen(inputTable.totalAmount),
      x: inputTable.x + breakdownWidth,
      y: totalTop + 14,
      font: `700 16px ${fontFamily}`,
      color: inputTable.amountColor,
      align: "right",
    });
  }

  drawBreakdownTable({
    title: "収入の内訳",
    rows: incomeRows,
    totalLabel: "収入合計",
    totalAmount: input.totals.incomeTotal,
    x: padding,
    amountColor: "#047857",
  });
  drawBreakdownTable({
    title: "支出の内訳",
    rows: expenseRows,
    totalLabel: "支出合計",
    totalAmount: input.totals.expenseTotal,
    x: padding + breakdownWidth + breakdownGap,
    amountColor: "#111827",
  });

  return canvas.toDataURL("image/png");
}

export default function AccountingReportClient({
  targetMonth,
  rows,
  totals,
  incomeItems,
  expenseItems,
  cumulativeBalance,
}: Props) {
  const [isExporting, setIsExporting] = useState(false);
  const incomeBreakdownRows = getIncomeBreakdownRows(totals, incomeItems);
  const expenseBreakdownRows = getExpenseBreakdownRows(totals, expenseItems);
  const coachPaymentSection = (
    <section className="mt-6">
      <div className="border-b border-gray-300 pb-2">
        <div>
          <h3 className="text-lg font-bold text-gray-900">
            指導者別 報酬一覧
          </h3>
          <p className="mt-1 text-xs font-medium text-gray-600">
            報酬、源泉税、未払い控除後の手取りを確認する一覧です。
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[16%]" />
            <col className="w-[27%]" />
            <col className="w-[13%]" />
            <col className="w-[30%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-300 text-left text-xs font-bold text-gray-600">
              <th className="py-3 pr-3">指導者</th>
              <th className="px-3 py-3">勤務</th>
              <th className="px-3 py-3 text-right">報酬</th>
              <th className="px-3 py-3 text-right">源泉税</th>
              <th className="py-3 pl-3 text-right">手取り</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.coachId} className="border-b border-gray-200">
                <td className="break-words py-4 pr-3 align-top font-bold text-gray-900">
                  {row.coachName}
                </td>
                <td className="px-3 py-4 align-top">
                  <p className="font-bold text-gray-900">
                    {formatMinutes(row.totalWorkMinutes)}
                  </p>
                  <p className="mt-1 text-xs font-medium text-gray-600">
                    指導 {formatMinutes(row.coachingMinutes)} / 事務{" "}
                    {formatMinutes(row.adminMinutes)}
                  </p>
                </td>
                <td className="px-3 py-4 text-right align-top">
                  <div className="ml-auto w-full max-w-[240px]">
                    <p className="font-bold text-gray-900">
                      {formatYen(row.grossReward)}
                    </p>
                    <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-xs font-medium text-gray-600">
                      <span className="text-left">時給</span>
                      <span>{formatYen(row.hourlyRate)}</span>
                      <span className="text-left">基本</span>
                      <span>{formatYen(row.baseReward)}</span>
                      {row.rewardCutTotal > 0 && (
                        <>
                          <span className="text-left text-red-700">
                            報酬調整
                          </span>
                          <span className="font-bold text-red-700">
                            -{formatYen(row.rewardCutTotal)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {row.rewardAdjustments.length > 0 && (
                    <div className="mt-2 ml-auto w-full max-w-[240px] space-y-1 rounded border border-red-200 bg-red-50/70 p-2 text-left">
                      {row.rewardAdjustments.map((adjustment) => (
                        <p
                          key={adjustment.id}
                          className="text-xs font-medium text-red-700"
                        >
                          {adjustment.pay_rate_percent}%{" "}
                          {formatRewardAdjustmentPeriod(adjustment)}
                        </p>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-4 text-right align-top font-bold text-orange-700">
                  {formatYen(row.taxOfficePayment)}
                </td>
                <td className="py-4 pl-3 text-right align-top">
                  <p
                    className={`text-lg font-bold ${balanceTextClass(
                      row.netPay
                    )}`}
                  >
                    {formatYen(row.netPay)}
                  </p>
                  {row.unpaidDeductionTotal > 0 && (
                    <div className="mt-2 ml-auto w-full max-w-[320px] rounded border border-red-200 bg-red-50/70 p-2 text-xs text-red-800">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
                        <span className="text-left font-medium">控除前</span>
                        <span className="font-bold">
                          {formatYen(row.netPayBeforeDeduction)}
                        </span>
                        <span className="text-left font-medium">
                          未払い控除
                        </span>
                        <span className="font-bold">
                          -{formatYen(row.unpaidDeductionTotal)}
                        </span>
                      </div>

                      <div className="mt-2 space-y-1 border-t border-red-200 pt-2">
                        {row.deductionItems.map((item) => (
                          <div
                            key={item.id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"
                          >
                            <span className="whitespace-normal break-words text-left font-medium leading-snug">
                              {deductionItemLabel(item)}
                            </span>
                            <span className="font-bold">
                              -{formatYen(item.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  function downloadReportImage() {
    if (isExporting) return;

    setIsExporting(true);

    try {
      const dataUrl = createReportImageDataUrl({
        targetMonth,
        rows,
        totals,
        incomeItems,
        expenseItems,
        cumulativeBalance,
      });
      const link = document.createElement("a");

      link.href = dataUrl;
      link.download = `accounting-report-${targetMonth}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error(error);
      window.alert("画像の作成に失敗しました");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className="rounded-lg bg-white p-5 shadow">
      <div className="flex flex-col gap-3 border-b border-gray-300 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-bold text-gray-600">会計報告書</p>
          <h2 className="mt-1 text-2xl font-bold text-gray-900">
            {formatTargetMonth(targetMonth)}
          </h2>
          <p className="mt-2 text-sm font-medium text-gray-700">
            指導者別時給（未設定 {formatYen(COACH_HOURLY_RATE)} / 時間）、源泉税率{" "}
            {formatTaxRate()}（支給報酬のみ）
          </p>
        </div>

        <button
          type="button"
          onClick={downloadReportImage}
          disabled={isExporting}
          aria-disabled={isExporting}
          className="rounded bg-black px-4 py-3 font-bold text-white disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          共有画像を保存
        </button>
      </div>

      <div className="mt-5 border border-gray-300">
        <div className="grid divide-y divide-gray-300 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          <div className="p-4">
            <p className="text-sm font-bold text-gray-600">A. 収入合計</p>
            <p className="mt-2 text-2xl font-bold text-green-700">
              {formatYen(totals.incomeTotal)}
            </p>
            <p className="mt-1 text-xs font-medium text-gray-600">
              月謝、協賛金、その他収入
            </p>
          </div>

          <div className="p-4">
            <p className="text-sm font-bold text-gray-600">B. 支出合計</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              {formatYen(totals.expenseTotal)}
            </p>
            <p className="mt-1 text-xs font-medium text-gray-600">
              指導者報酬、源泉税、その他出費
            </p>
          </div>

          <div className={`p-4 ${balanceClass(totals.balance)}`}>
            <p className="text-sm font-bold">C. 月次収支</p>
            <p className="mt-2 text-3xl font-bold">
              {formatYen(totals.balance)}
            </p>
            <p className="mt-1 text-xs font-bold">
              {balanceLabel(totals.balance)}
            </p>
          </div>
        </div>

        <div className="border-t border-gray-300 px-4 py-3 text-sm font-bold text-gray-800">
          {formatYen(totals.incomeTotal)} - {formatYen(totals.expenseTotal)} ={" "}
          <span className={balanceTextClass(totals.balance)}>
            {formatYen(totals.balance)}
          </span>
          <span className="ml-3 text-xs font-medium text-gray-600">
            累計収支（選択月まで） {formatYen(cumulativeBalance)}
          </span>
        </div>
      </div>

      {coachPaymentSection}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="border-b border-gray-300 pb-2 text-base font-bold text-gray-900">
            収入の内訳
          </h3>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {incomeBreakdownRows.map((row) => (
                <tr key={row.label} className="border-b border-gray-200">
                  <td className="py-3 pr-3 align-top">
                    <p className="font-bold text-gray-900">{row.label}</p>
                    <p className="mt-1 text-xs font-medium text-gray-600">
                      {row.note}
                    </p>
                    {row.details && row.details.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {row.details.map((detail) => (
                          <div
                            key={detail.id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium text-gray-800">
                                {detail.label}
                              </p>
                              {detail.note && (
                                <p className="mt-0.5 truncate font-medium text-gray-500">
                                  {detail.note}
                                </p>
                              )}
                            </div>
                            <p className="font-bold text-green-700">
                              {formatYen(detail.amount)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pl-3 text-right align-top font-bold text-green-700">
                    {formatYen(row.amount)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="pt-3 pr-3 text-base font-bold text-gray-900">
                  収入合計
                </td>
                <td className="pt-3 pl-3 text-right text-base font-bold text-green-700">
                  {formatYen(totals.incomeTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="border-b border-gray-300 pb-2 text-base font-bold text-gray-900">
            支出の内訳
          </h3>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {expenseBreakdownRows.map((row) => (
                <tr key={row.label} className="border-b border-gray-200">
                  <td className="py-3 pr-3 align-top">
                    <p className="font-bold text-gray-900">{row.label}</p>
                    <p className="mt-1 text-xs font-medium text-gray-600">
                      {row.note}
                    </p>
                    {row.details && row.details.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {row.details.map((detail) => (
                          <div
                            key={detail.id}
                            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium text-gray-800">
                                {detail.label}
                              </p>
                              {detail.note && (
                                <p className="mt-0.5 truncate font-medium text-gray-500">
                                  {detail.note}
                                </p>
                              )}
                            </div>
                            <p className="font-bold text-gray-900">
                              {formatYen(detail.amount)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pl-3 text-right align-top font-bold text-gray-900">
                    {formatYen(row.amount)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="pt-3 pr-3 text-base font-bold text-gray-900">
                  支出合計
                </td>
                <td className="pt-3 pl-3 text-right text-base font-bold text-gray-900">
                  {formatYen(totals.expenseTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}
