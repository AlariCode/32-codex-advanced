import Link from "next/link";
import type { ComponentProps } from "react";
import styles from "./controls.module.css";

type ActionLinkProps = ComponentProps<typeof Link> & {
  variant?: "primary" | "text";
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
