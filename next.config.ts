import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // 5MBのCSVとmultipartの付加情報を受け付け、ファイル自体の上限は画面とActionで判定する。
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
