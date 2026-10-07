import { AccountLayout } from "@/shared/ui";
import { LoginForm } from "./login-form";

export function LoginPage() {
  return (
    <AccountLayout
      story={{
        titleId: "login-story-title",
        eyebrow: "Рады видеть вас снова",
        intro: "Статьи, идеи и находки, к которым хочется вернуться. Войдите в свой аккаунт Linkbook.",
        articleLabel: "01 / ВЕРНУТЬСЯ К ВАЖНОМУ",
        articleTitle: <>Хорошие идеи<br />заслуживают продолжения.</>,
        note: "Своя коллекция. Свой ритм.",
      }}
      heading={{
        titleId: "login-title",
        eyebrow: "С возвращением",
        title: "Вход",
        description: "Введите email и пароль своего аккаунта.",
      }}
    >
      <LoginForm />
    </AccountLayout>
  );
}
