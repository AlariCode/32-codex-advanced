import { ActionLink } from "@/shared/ui";

export function LibraryWelcome({ children }: { children?: React.ReactNode }) {
  return (
    <main>
      <h1>Linkbook</h1>
      <p>Сохраняйте статьи, чтобы вернуться к ним позже.</p>
      <ActionLink href="/register" variant="primary">
        Создать аккаунт <span aria-hidden="true">→</span>
      </ActionLink>
      <p>
        <ActionLink href="/login">
          Уже есть аккаунт? Войти <span aria-hidden="true">→</span>
        </ActionLink>
      </p>
      {children}
    </main>
  );
}
