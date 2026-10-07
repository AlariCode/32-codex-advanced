"use client";

import styles from "./password-visibility-toggle.module.css";

interface PasswordVisibilityToggleProps {
  visible: boolean;
  disabled: boolean;
  inputId: string;
  onToggle: () => void;
}

export function PasswordVisibilityToggle({ visible, disabled, inputId, onToggle }: PasswordVisibilityToggleProps) {
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
      aria-pressed={visible}
      aria-controls={inputId}
      disabled={disabled}
      onClick={onToggle}
    >
      {visible ? "Скрыть" : "Показать"}
    </button>
  );
}
