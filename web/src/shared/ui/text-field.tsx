import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./controls.module.css";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  action?: ReactNode;
}

export function TextField({ id, label, hint, error, action, ...props }: TextFieldProps) {
  const description = error || hint;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.inputRow}>
        <input {...props} id={id} aria-invalid={Boolean(error)} aria-describedby={description ? `${id}-description` : undefined} />
        {action}
      </div>
      {description && <p id={`${id}-description`} role={error ? "alert" : undefined} className={error ? styles.error : styles.hint}>{description}</p>}
    </div>
  );
}
