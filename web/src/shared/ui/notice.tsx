import type { ComponentProps } from "react";
import styles from "./notice.module.css";

type NoticeProps = ComponentProps<"p"> & {
  tone: "danger" | "warning" | "success";
};

export function Notice({ tone, className = "", ...props }: NoticeProps) {
  return (
    <p className={`${styles.notice} ${styles[tone]} ${className}`} {...props} />
  );
}
