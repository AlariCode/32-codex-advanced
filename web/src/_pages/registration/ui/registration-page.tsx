import { AccountLayout } from "@/shared/ui";
import { RegistrationForm } from "./registration-form";

export function RegistrationPage() {
  return (
    <AccountLayout
      title="Регистрация"
      description="Введите email и придумайте пароль."
      intro="Собирайте статьи, идеи и находки в личной библиотеке."
    >
      <RegistrationForm />
    </AccountLayout>
  );
}
