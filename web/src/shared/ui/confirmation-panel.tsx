import type { ComponentProps } from "react";
import styles from "./notice.module.css";

export function ConfirmationPanel({
  className = "",
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={`${styles.confirmation} ${styles.danger} ${className}`}
      {...props}
    />
  );
}
