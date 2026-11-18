import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import styles from "./controls.module.css";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
  id: string;
  label: string;
  hint?: string;
  error?: string;
  action?: ReactNode;
}

export function TextField({
  id,
  label,
  hint,
  error,
  action,
  ...props
}: TextFieldProps) {
  const description = error || hint;
  const descriptionId = description ? `${id}-description` : undefined;
  const describedBy = [props["aria-describedby"], descriptionId]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.inputRow}>
        <input
          {...props}
          id={id}
          aria-invalid={error ? true : (props["aria-invalid"] ?? false)}
          aria-describedby={describedBy || undefined}
        />
        {action}
      </div>
      {description && (
        <p
          id={descriptionId}
          role={error ? "alert" : undefined}
          className={error ? styles.error : styles.hint}
        >
          {description}
        </p>
      )}
    </div>
  );
}
