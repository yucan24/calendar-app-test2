export type BankProfile = {
  id: string;
  name: string;
};

export type PaymentAlias = {
  id: string;
  profileId: string;
  profileName: string;
  aliasName: string;
  normalizedAliasName: string;
  note: string | null;
};

export type BankTransactionMatch = {
  id: string;
  direction: "deposit" | "withdrawal";
  matchType:
    | "billing_item"
    | "accounting_income_item"
    | "accounting_expense_item"
    | "coach_net_pay"
    | "tax_payment"
    | "manual";
  targetId: string | null;
  targetKey: string | null;
  profileId: string | null;
  targetMonth: string | null;
  amount: number;
  expectedAmount?: number | null;
  ownsTarget?: boolean;
  settlesPayment?: boolean;
  note: string | null;
  createdAt: string;
};

export type BankTransaction = {
  id: string;
  bankTransactionId: string;
  accountLabel?: string;
  transactedOn: string;
  withdrawalAmount: number;
  depositAmount: number;
  description: string;
  normalizedDescription: string;
  balance: number | null;
  status: "unmatched" | "matched" | "ignored";
  memo: string | null;
  matches: BankTransactionMatch[];
};

export type ReconciliationBillingItem = {
  id: string;
  userId: string;
  userName: string;
  targetMonth: string;
  category: string;
  title: string;
  amount: number;
  status: string;
};

export type CoachPaymentCandidate = {
  coachId: string;
  coachName: string;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  deductionTotal: number;
};

export type ExistingAccountingItem = {
  itemType: "income" | "expense";
  itemId: string;
  transactedOn: string;
  partyName: string;
  category: string;
  title: string;
  amount: number;
  note: string | null;
};

export type BankCsvImport = {
  id: string;
  sourceFilename: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  periodStart: string | null;
  periodEnd: string | null;
  importedCount: number;
  skippedCount: number;
  conflictCount: number;
  createdAt: string;
};
