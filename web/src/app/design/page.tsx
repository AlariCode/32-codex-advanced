import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Дизайн-система — Linkbook",
  robots: { index: false, follow: false },
};

export default async function DesignRoute() {
  if (process.env.NODE_ENV !== "development") notFound();

  const { DesignPage } = await import("@/_pages/design");
  return <DesignPage />;
}
