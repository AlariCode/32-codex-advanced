import type { NextConfig } from "next";

const apiOrigin = (
  process.env.API_ORIGIN ?? `http://127.0.0.1:${process.env.API_PORT ?? "8080"}`
).replace(/\/$/, "");

const nextConfig: NextConfig = {
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
      { source: "/api/users/me", destination: `${apiOrigin}/api/users/me` },
      { source: "/api/links", destination: `${apiOrigin}/api/links` },
      { source: "/api/links/:id", destination: `${apiOrigin}/api/links/:id` },
    ];
  },
};

export default nextConfig;
