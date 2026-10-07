import { AccountLayout } from "@/shared/ui";
import { RegistrationForm } from "./registration-form";

export function RegistrationPage() {
  return (
    <AccountLayout
      story={{
        titleId: "story-title",
        eyebrow: "Сохраняйте то, что важно",
        intro: "Статьи, идеи и находки, к которым хочется вернуться. Начните свою коллекцию с Linkbook.",
        articleLabel: "01 / СОХРАНИТЬ НА ПОТОМ",
        articleTitle: <>Меньше открытых вкладок.<br />Больше хороших идей.</>,
        note: "Собирайте сегодня. Возвращайтесь, когда удобно.",
      }}
      heading={{
        titleId: "registration-title",
        eyebrow: "Начнём с аккаунта",
        title: "Регистрация",
        description: "Всего два поля — и ваш аккаунт готов.",
      }}
    >
      <RegistrationForm />
    </AccountLayout>
  );
}
