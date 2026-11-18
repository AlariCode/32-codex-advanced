import type { ComponentProps } from "react";
import styles from "./notice.module.css";

type StatusLabelProps = ComponentProps<"p"> & {
  tone?: "danger" | "warning" | "success" | "neutral";
};

export function StatusLabel({
  tone = "neutral",
  className = "",
  ...props
}: StatusLabelProps) {
  return (
    <p
      className={`${styles.statusLabel} ${styles[tone]} ${className}`}
      {...props}
    />
  );
}
