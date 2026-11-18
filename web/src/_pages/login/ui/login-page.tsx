import { AccountLayout } from "@/shared/ui";
import { LoginForm } from "./login-form";

export function LoginPage() {
  return (
    <AccountLayout
      title="Вход"
      description="Введите email и пароль своего аккаунта."
      intro="Откройте свою коллекцию и продолжите чтение сохранённых статей."
    >
      <LoginForm />
    </AccountLayout>
  );
}
