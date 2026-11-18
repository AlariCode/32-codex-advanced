import type { ComponentProps } from "react";
import styles from "./account-layout.module.css";

export function AccountForm(props: ComponentProps<"form">) {
  return <form {...props} className={styles.form} />;
}

export function AccountFormNote(props: ComponentProps<"p">) {
  return <p {...props} className={styles.formNote} />;
}
