import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "@fontsource-variable/inter/wght-italic.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Linkbook",
  description: "Ссылки на статьи для последующего чтения",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
