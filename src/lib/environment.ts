export const PRODUCTION_SUPABASE_REF = "wswntpyibylcrjjdmguy";
export const TEST_SUPABASE_REF = "xvgqwdiyoorzejfozoca";

export function assertDevelopmentDatabase(url: string, nodeEnvironment: string | undefined) {
  if (nodeEnvironment !== "development") return;
  const host = new URL(url).hostname;
  if ([PRODUCTION_SUPABASE_REF, "tqkblkxjgbnxoqkralmn"].some((ref) => host === `${ref}.supabase.co`)) {
    throw new Error("開発サーバーから本番DBへ接続できません。.env.localをテスト用Supabaseに設定してください。");
  }
}

export function assertDatabaseEnvironment(url: string, nodeEnvironment: string | undefined, deploymentEnvironment?: string) {
  assertDevelopmentDatabase(url, nodeEnvironment);
  const host = new URL(url).hostname;
  if (deploymentEnvironment === "production" && host !== `${PRODUCTION_SUPABASE_REF}.supabase.co`) {
    throw new Error("本番公開には本番用Supabaseを設定してください。");
  }
  if (deploymentEnvironment === "preview" && host !== `${TEST_SUPABASE_REF}.supabase.co`) {
    throw new Error("プレビューにはテスト用Supabaseを設定してください。");
  }
}
