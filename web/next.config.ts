import type { NextConfig } from "next";

const apiOrigin = (process.env.API_ORIGIN ?? `http://127.0.0.1:${process.env.API_PORT ?? "8080"}`).replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/users/register", destination: `${apiOrigin}/api/users/register` },
      { source: "/api/users/login", destination: `${apiOrigin}/api/users/login` },
    ];
  },
};

export default nextConfig;
