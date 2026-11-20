export type BankDirection = "deposit" | "withdrawal";

export type ParsedBankCsv = {
  meta: {
    bankName: string;
    branchName: string;
    accountType: string;
    accountNumber: string;
    periodStart: string | null;
    periodEnd: string | null;
    exportedAt: string;
  };
  transactions: ParsedBankTransaction[];
};

export type ParsedBankTransaction = {
  bankTransactionId: string;
  transactedOn: string;
  withdrawalAmount: number;
  depositAmount: number;
  description: string;
  normalizedDescription: string;
  balance: number | null;
};

export type BankTransactionLike = {
  transactedOn: string;
  withdrawalAmount: number;
  depositAmount: number;
  description: string;
  normalizedDescription?: string;
};

export type ProfilePaymentAliasLike = {
  profileId: string;
  profileName: string;
  aliasName: string;
  normalizedAliasName: string;
};

export type ProfileCandidate = {
  profileId: string;
  profileName: string;
  aliasName: string;
  score: number;
};

export type PurposeCategory =
  | "tuition"
  | "trip"
  | "uniform"
  | "event"
  | "sponsorship"
  | "refund"
  | "tax";

export type InferredPurpose = {
  category: PurposeCategory;
  label: string;
  keyword: string;
};

export type MatchBillingItemLike = {
  id: string;
  userId: string;
  userName: string;
  targetMonth: string;
  category: string;
  title: string;
  amount: number;
  status: string;
};

export type MatchCandidate = {
  billingItemId: string;
  userId: string;
  userName: string;
  targetMonth: string;
  category: string;
  title: string;
  amount: number;
  score: number;
  confidence: "high" | "review" | "unknown";
  reasons: string[];
};

export type BuildMatchCandidatesInput = {
  transaction: BankTransactionLike;
  aliases: ProfilePaymentAliasLike[];
  billingItems: MatchBillingItemLike[];
};

const PURPOSE_KEYWORDS: Array<{
  keyword: string;
  category: PurposeCategory;
  label: string;
}> = [
  { keyword: "ゲツシヤ", category: "tuition", label: "月謝" },
  { keyword: "ツキシヤ", category: "tuition", label: "月謝" },
  { keyword: "月謝", category: "tuition", label: "月謝" },
  { keyword: "エンセイヒ", category: "trip", label: "遠征費" },
  { keyword: "遠征", category: "trip", label: "遠征費" },
  { keyword: "Tシヤツ", category: "uniform", label: "Tシャツ" },
  { keyword: "Tシャツ", category: "uniform", label: "Tシャツ" },
  { keyword: "ユニフォーム", category: "uniform", label: "ユニフォーム" },
  { keyword: "タイカイ", category: "event", label: "大会費" },
  { keyword: "大会", category: "event", label: "大会費" },
  { keyword: "キョウサン", category: "sponsorship", label: "協賛金" },
  { keyword: "協賛", category: "sponsorship", label: "協賛金" },
  { keyword: "ヘンキン", category: "refund", label: "返金" },
  { keyword: "返金", category: "refund", label: "返金" },
  { keyword: "ゼイムシヨ", category: "tax", label: "税務署" },
  { keyword: "税務署", category: "tax", label: "税務署" },
];

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new Error("CSVのダブルクォートが閉じられていません");
  }

  if (field || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }

  return rows.filter((values) =>
    values.some((value) => value.trim().length > 0)
  );
}

function decodeBankCsv(buffer: ArrayBuffer) {
  // UTF-8を先に厳密に判定する。Shift_JISで先に読むと日本語が文字化けする。
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/u, "");
  } catch {
    // UTF-8として不正な場合は銀行標準のCP932を読む。
  }
  const encodings = ["shift_jis", "windows-31j", "ms932"];

  for (const encoding of encodings) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer).replace(/^\uFEFF/u, "");
    } catch {
      // 実行環境が対応している次のCP932互換名を試す。
    }
  }

  throw new Error("CSVの文字コードを読み取れません。CP932またはUTF-8で保存してください");
}

function parseCompactDate(value: string, label: string) {
  const trimmed = value.trim();

  if (!trimmed) return null;

  const match = /^(\d{4})(\d{2})(\d{2})$/u.exec(trimmed);

  if (!match) {
    throw new Error(`${label}の日付形式が不正です`);
  }

  return validateDateParts(match[1], match[2], match[3], label);
}

function parseSlashDate(value: string, label: string) {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/u.exec(value.trim());

  if (!match) {
    throw new Error(`${label}の日付形式が不正です`);
  }

  return validateDateParts(match[1], match[2], match[3], label);
}

function validateDateParts(
  yearValue: string,
  monthValue: string,
  dayValue: string,
  label: string
) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${label}の日付が不正です`);
  }

  return `${yearValue}-${monthValue}-${dayValue}`;
}

function parseNonNegativeInteger(
  value: string,
  label: string
) {
  const normalized = value.replace(/,/gu, "").trim();

  if (!normalized) return 0;

  const amount = Number(normalized);

  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`${label}は0以上の整数である必要があります`);
  }

  return amount;
}

function parseOptionalInteger(value: string, label: string) {
  const normalized = value.replace(/,/gu, "").trim();

  if (!normalized) return null;

  const amount = Number(normalized);

  if (!Number.isSafeInteger(amount)) {
    throw new Error(`${label}は整数である必要があります`);
  }

  return amount;
}

export function normalizeBankText(value: string) {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s\u3000・･._\-‐‑‒–—―_/\\]/gu, "")
    .replace(/^P[BE](?=[\p{L}\p{N}])/u, "")
    .trim();
}

export function parseBankCsv(buffer: ArrayBuffer): ParsedBankCsv {
  const rows = parseCsvRows(decodeBankCsv(buffer));

  if (rows.length < 2) {
    throw new Error("口座情報と明細を含むCSVを選択してください");
  }

  const metaRow = rows[0];

  if (metaRow.length < 7) {
    throw new Error("CSVの口座情報行が不正です");
  }

  const transactions = rows.slice(1).map((values, index) => {
    const rowNumber = index + 2;

    if (values.length < 6) {
      throw new Error(`${rowNumber}行目の列数が不足しています`);
    }

    const bankTransactionId = values[0].trim();
    const transactedOn = parseSlashDate(values[1], `${rowNumber}行目の取引日`);
    const withdrawalAmount = parseNonNegativeInteger(
      values[2],
      `${rowNumber}行目の出金額`
    ) as number;
    const depositAmount = parseNonNegativeInteger(
      values[3],
      `${rowNumber}行目の入金額`
    ) as number;
    const description = values[4].trim();
    const balance = parseOptionalInteger(values[5], `${rowNumber}行目の残高`);

    if (!bankTransactionId) {
      throw new Error(`${rowNumber}行目の取引番号が空です`);
    }

    if (
      (withdrawalAmount > 0 && depositAmount > 0) ||
      (withdrawalAmount === 0 && depositAmount === 0)
    ) {
      throw new Error(`${rowNumber}行目の入出金額が不正です`);
    }

    return {
      bankTransactionId,
      transactedOn,
      withdrawalAmount,
      depositAmount,
      description,
      normalizedDescription: normalizeBankText(description),
      balance,
    };
  });

  return {
    meta: {
      bankName: metaRow[0].trim(),
      branchName: metaRow[1].trim(),
      accountType: metaRow[2].trim(),
      accountNumber: metaRow[3].trim(),
      periodStart: parseCompactDate(metaRow[4], "取引期間の開始日"),
      periodEnd: parseCompactDate(metaRow[5], "取引期間の終了日"),
      exportedAt: metaRow[6].trim(),
    },
    transactions,
  };
}

export function getBankDirection(
  transaction: Pick<
    BankTransactionLike,
    "withdrawalAmount" | "depositAmount"
  >
): BankDirection {
  if (transaction.depositAmount > 0 && transaction.withdrawalAmount === 0) {
    return "deposit";
  }

  if (transaction.withdrawalAmount > 0 && transaction.depositAmount === 0) {
    return "withdrawal";
  }

  throw new Error("入出金方向を判定できません");
}

export function getBankTransactionAmount(
  transaction: Pick<
    BankTransactionLike,
    "withdrawalAmount" | "depositAmount"
  >
) {
  return getBankDirection(transaction) === "deposit"
    ? transaction.depositAmount
    : transaction.withdrawalAmount;
}

export function inferTransactionPurpose(description: string) {
  const normalizedDescription = normalizeBankText(description);
  const found = new Map<PurposeCategory, InferredPurpose>();

  for (const item of PURPOSE_KEYWORDS) {
    const normalizedKeyword = normalizeBankText(item.keyword);

    if (
      normalizedKeyword &&
      normalizedDescription.includes(normalizedKeyword) &&
      !found.has(item.category)
    ) {
      found.set(item.category, item);
    }
  }

  return Array.from(found.values());
}

export function inferProfileCandidates(
  transaction: BankTransactionLike,
  aliases: ProfilePaymentAliasLike[]
) {
  const description =
    transaction.normalizedDescription || normalizeBankText(transaction.description);
  const candidateByProfile = new Map<string, ProfileCandidate>();

  for (const alias of aliases) {
    const normalizedAlias =
      alias.normalizedAliasName || normalizeBankText(alias.aliasName);

    if (!normalizedAlias || !description.includes(normalizedAlias)) continue;

    const score = description === normalizedAlias ? 70 : 60;
    const current = candidateByProfile.get(alias.profileId);

    if (!current || current.score < score) {
      candidateByProfile.set(alias.profileId, {
        profileId: alias.profileId,
        profileName: alias.profileName,
        aliasName: alias.aliasName,
        score,
      });
    }
  }

  return Array.from(candidateByProfile.values()).sort(
    (left, right) => right.score - left.score || left.profileName.localeCompare(right.profileName, "ja")
  );
}

function isRefundBillingItem(item: MatchBillingItemLike) {
  return item.title === "返金" || item.category === "refund";
}

function monthDistance(transactionDate: string, targetMonth: string) {
  const [transactionYear, transactionMonth] = transactionDate
    .slice(0, 7)
    .split("-")
    .map(Number);
  const [targetYear, targetMonthNumber] = targetMonth.split("-").map(Number);

  return Math.abs(
    transactionYear * 12 +
      transactionMonth -
      (targetYear * 12 + targetMonthNumber)
  );
}

export function buildMatchCandidates({
  transaction,
  aliases,
  billingItems,
}: BuildMatchCandidatesInput) {
  const direction = getBankDirection(transaction);
  const transactionAmount = getBankTransactionAmount(transaction);
  const profileCandidates = inferProfileCandidates(transaction, aliases);
  const profileScoreById = new Map(
    profileCandidates.map((candidate) => [candidate.profileId, candidate.score])
  );
  const purposes = inferTransactionPurpose(transaction.description);
  const purposeCategories = new Set(purposes.map((purpose) => purpose.category));
  const compatibleItems = billingItems.filter((item) => {
    if (item.status !== "unpaid" || item.amount <= 0) return false;
    return direction === "withdrawal"
      ? isRefundBillingItem(item)
      : !isRefundBillingItem(item);
  });
  const unpaidTotalByUser = new Map<string, number>();

  for (const item of compatibleItems) {
    unpaidTotalByUser.set(
      item.userId,
      (unpaidTotalByUser.get(item.userId) ?? 0) + item.amount
    );
  }

  return compatibleItems
    .map((item): MatchCandidate => {
      let score = 0;
      const reasons: string[] = [];
      const profileScore = profileScoreById.get(item.userId) ?? 0;

      if (profileScore > 0) {
        score += profileScore;
        reasons.push("名義一致");
      }

      if (item.amount === transactionAmount) {
        score += 30;
        reasons.push("金額一致");
      } else if (unpaidTotalByUser.get(item.userId) === transactionAmount) {
        score += 25;
        reasons.push("未払い合計と一致");
      }

      if (purposeCategories.has(item.category as PurposeCategory)) {
        score += 20;
        reasons.push("用途一致");
      }

      const transactionDay = Number(transaction.transactedOn.slice(8, 10));
      const transactionMonth = transaction.transactedOn.slice(0, 7);

      if (
        direction === "deposit" &&
        item.category === "tuition" &&
        item.targetMonth === transactionMonth
      ) {
        score += 10;
        reasons.push("同月の月謝");

        if (transactionDay >= 1 && transactionDay <= 15) {
          score += 5;
          reasons.push("月前半");
        }
      }

      if (monthDistance(transaction.transactedOn, item.targetMonth) <= 1) {
        score += 5;
        reasons.push("対象月が近い");
      }

      return {
        billingItemId: item.id,
        userId: item.userId,
        userName: item.userName,
        targetMonth: item.targetMonth,
        category: item.category,
        title: item.title,
        amount: item.amount,
        score,
        confidence:
          profileScore > 0 && item.amount === transactionAmount
            ? "high"
            : score > 0
              ? "review"
              : "unknown",
        reasons,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.targetMonth.localeCompare(left.targetMonth) ||
        left.userName.localeCompare(right.userName, "ja")
    );
}
