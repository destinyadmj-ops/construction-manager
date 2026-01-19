import type { NextConfig } from "next";

const devAllowedOrigins = ["127.0.0.1", "localhost", "192.168.1.24"];

const nextConfig: NextConfig = {
  // Vercel等の動的サーバー運用用
  output: 'standalone',
  // Next.js dev (Turbopack) の cross-origin (_next/*) ブロックを抑止
  // Next のバージョンによっては experimental 側は未対応のため入れない
  allowedDevOrigins: devAllowedOrigins,
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
