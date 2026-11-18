import type { ComponentProps } from "react";
import styles from "./controls.module.css";

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "danger" | "text" | "dangerText";
};

export function Button({
  className = "",
  variant = "primary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${styles.button} ${styles[variant]} ${className}`}
      type={type}
      {...props}
    />
  );
}
