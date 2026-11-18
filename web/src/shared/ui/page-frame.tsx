import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ActionLink } from "./action-link";
import styles from "./page-frame.module.css";

export function Brand({ homeLink = false }: { homeLink?: boolean }) {
  const mark = (
    <>
      <span className={styles.mark} aria-hidden="true">
        ↗
      </span>{" "}
      Linkbook
    </>
  );
  return homeLink ? (
    <Link href="/" className={styles.brand}>
      {mark}
    </Link>
  ) : (
    <span className={styles.brand}>{mark}</span>
  );
}

export function PageHeader({
  back,
  children,
}: {
  back?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      {back ? <ActionLink href="/">← В библиотеку</ActionLink> : <Brand />}
      {back ? <Brand /> : children}
    </header>
  );
}

export function PageFrame({
  className = "",
  ...props
}: ComponentProps<"main">) {
  return <main className={`${styles.page} ${className}`} {...props} />;
}

export function ActionRow({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`${styles.actions} ${className}`} {...props} />;
}

export function EmptyState({
  title,
  children,
  heading: Heading = "h2",
}: {
  title: string;
  children: ReactNode;
  heading?: "h2" | "h3";
}) {
  return (
    <div className={styles.empty}>
      <Heading>{title}</Heading>
      <p>{children}</p>
    </div>
  );
}

export function FieldAction({ children }: { children: ReactNode }) {
  return <div className={styles.fieldAction}>{children}</div>;
}
