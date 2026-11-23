type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

// Supabaseの1レスポンス上限に依存せず、月次集計や照合の全対象を取得する。
// 呼出側は一意なキーを含む安定した順序を指定する。
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<QueryResult<T>>,
  pageSize = 500
): Promise<QueryResult<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}
