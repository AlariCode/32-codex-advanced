import Link from "next/link";

export function LibraryWelcome({ children }: { children?: React.ReactNode }) {
  return (
    <main>
      <h1>Linkbook</h1>
      <p>Сохраняйте статьи, чтобы вернуться к ним позже.</p>
      <Link href="/register" className="registration-link">
        Создать аккаунт <span aria-hidden="true">→</span>
      </Link>
      <p>
        <Link href="/login" className="login-link">
          Уже есть аккаунт? Войти <span aria-hidden="true">→</span>
        </Link>
      </p>
      {children}
    </main>
  );
}
