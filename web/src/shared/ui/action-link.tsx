import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import styles from "./controls.module.css";

type ActionLinkProps = ComponentProps<typeof Link> & {
  variant?: "primary" | "secondary" | "text";
};

export function ActionLink({
  variant = "text",
  className = "",
  ...props
}: ActionLinkProps) {
  return (
    <Link
      className={`${styles.button} ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function ExternalActionLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <ActionLink href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </ActionLink>
  );
}
