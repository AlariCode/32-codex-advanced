import { ActionLink, ActionRow, PageFrame, PageHeader } from "@/shared/ui";
import styles from "./library.module.css";

export function LibraryWelcome() {
  return (
    <PageFrame className={styles.library}>
      <PageHeader />
      <section className={styles.welcome} aria-labelledby="welcome-title">
        <h1 id="welcome-title">
          Хорошие ссылки.
          <br />В одном месте.
        </h1>
        <p>
          Сохраняйте статьи в личную библиотеку и возвращайтесь к ним, когда
          удобно.
        </p>
        <ActionRow>
          <ActionLink href="/register" variant="primary">
            Создать аккаунт
          </ActionLink>
          <ActionLink href="/login">Уже есть аккаунт? Войти</ActionLink>
        </ActionRow>
      </section>
    </PageFrame>
  );
}
