import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Linkbook</h1>
      <p>Сохраняйте статьи, чтобы вернуться к ним позже.</p>
      <p className="note">Библиотека ссылок скоро появится здесь.</p>
      <Link href="/register">Создать аккаунт →</Link>
    </main>
  );
}
