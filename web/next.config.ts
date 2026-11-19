import type { NextConfig } from "next";

const apiOrigin = (
  process.env.API_ORIGIN ?? `http://127.0.0.1:${process.env.API_PORT ?? "8080"}`
).replace(/\/$/, "");

const impeccableLiveDev =
  process.env.NODE_ENV === "development" ? " http://localhost:8400" : "";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/links/:id",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'${impeccableLiveDev}; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'${impeccableLiveDev}; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/users/register",
        destination: `${apiOrigin}/api/users/register`,
      },
      {
        source: "/api/users/login",
        destination: `${apiOrigin}/api/users/login`,
      },
      {
        source: "/api/users/logout",
        destination: `${apiOrigin}/api/users/logout`,
      },
      { source: "/api/users/me", destination: `${apiOrigin}/api/users/me` },
      {
        source: "/api/users/me/mcp-tokens/:path*",
        destination: `${apiOrigin}/api/users/me/mcp-tokens/:path*`,
      },
      { source: "/api/links", destination: `${apiOrigin}/api/links` },
      {
        source: "/api/links/statuses",
        destination: `${apiOrigin}/api/links/statuses`,
      },
      {
        source: "/api/links/:id/document",
        destination: `${apiOrigin}/api/links/:id/document`,
      },
      {
        source: "/api/links/:id/assets/:asset_id",
        destination: `${apiOrigin}/api/links/:id/assets/:asset_id`,
      },
      {
        source: "/api/links/:id/retry",
        destination: `${apiOrigin}/api/links/:id/retry`,
      },
      { source: "/api/links/:id", destination: `${apiOrigin}/api/links/:id` },
    ];
  },
};

export default nextConfig;
