import type { ReactNode } from "react";
import { Brand } from "./page-frame";
import styles from "./account-layout.module.css";

interface AccountLayoutProps {
  intro: string;
  title: string;
  description: string;
  children: ReactNode;
}

export function AccountLayout({
  intro,
  title,
  description,
  children,
}: AccountLayoutProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Brand homeLink />
      </header>
      <main className={styles.main}>
        <div className={styles.account}>
          <h1>{title}</h1>
          <p className={styles.description}>{description}</p>
          {children}
        </div>
        <aside className={styles.story}>
          <h2>Хорошие ссылки. В одном месте.</h2>
          <p>{intro}</p>
        </aside>
      </main>
    </div>
  );
}
