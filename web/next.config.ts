import type { NextConfig } from "next";

const apiOrigin = (process.env.API_ORIGIN ?? `http://127.0.0.1:${process.env.API_PORT ?? "8080"}`).replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/users/register", destination: `${apiOrigin}/api/users/register` }];
  },
};

export default nextConfig;
