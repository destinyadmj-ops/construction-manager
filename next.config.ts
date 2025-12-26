import type { NextConfig } from "next";

const devAllowedOrigins = ["127.0.0.1", "localhost", "192.168.1.24"];

const nextConfig: NextConfig = {
  // Next.js dev (Turbopack) の cross-origin (_next/*) ブロックを抑止
  // Next のバージョン差分に備えて experimental 側にも設定する
  allowedDevOrigins: devAllowedOrigins,
  experimental: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...( { allowedDevOrigins: devAllowedOrigins } as any ),
  },
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
