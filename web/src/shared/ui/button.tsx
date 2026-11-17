import type { ComponentProps } from "react";
import styles from "./controls.module.css";

export function Button({ className = "", ...props }: ComponentProps<"button">) {
  return <button className={`${styles.button} ${className}`} {...props} />;
}
