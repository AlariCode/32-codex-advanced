"use client";

import { announceSessionChange, safeReturnTo } from "@/shared/auth";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import {
  AccountForm,
  AccountFormNote,
  ActionLink,
  Button,
  Notice,
  PasswordVisibilityToggle,
  TextField,
} from "@/shared/ui";
import { registerUser, RegistrationError } from "../api/register-user";
import {
  registrationErrors,
  validateRegistration,
  type RegistrationErrors,
} from "../model/registration";

export function RegistrationForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const submitting = useRef(false);

  function showErrors(next: RegistrationErrors, form: HTMLFormElement) {
    setErrors(next);
    const field = next.email ? "email" : next.password ? "password" : undefined;
    if (field) (form.elements.namedItem(field) as HTMLInputElement)?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const nextErrors = validateRegistration(email, password);
    showErrors(nextErrors, form);
    if (Object.keys(nextErrors).length) return;
    submitting.current = true;
    setPending(true);
    try {
      await registerUser(email.trim(), password);
      setPassword("");
      announceSessionChange();
      router.replace(
        safeReturnTo(
          new URLSearchParams(window.location.search).get("returnTo"),
        ),
      );
      router.refresh();
    } catch (error) {
      showErrors(
        registrationErrors(
          error instanceof RegistrationError ? error.code : "internal_error",
        ),
        form,
      );
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <AccountForm onSubmit={handleSubmit} noValidate aria-busy={pending}>
      <TextField
        id="registration-email"
        name="email"
        type="email"
        label="Email"
        placeholder="you@example.com"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={email}
        readOnly={pending}
        error={errors.email}
        onChange={(event) => {
          setEmail(event.target.value);
          setErrors((current) => ({
            ...current,
            email: undefined,
            form: undefined,
          }));
        }}
      />
      <TextField
        id="registration-password"
        name="password"
        type={showPassword ? "text" : "password"}
        label="Пароль"
        placeholder="Придумайте пароль"
        autoComplete="new-password"
        required
        value={password}
        readOnly={pending}
        error={errors.password}
        hint="Минимум 8 символов. Можно использовать пробелы."
        onChange={(event) => {
          setPassword(event.target.value);
          setErrors((current) => ({
            ...current,
            password: undefined,
            form: undefined,
          }));
        }}
        action={
          <PasswordVisibilityToggle
            visible={showPassword}
            disabled={pending}
            inputId="registration-password"
            onToggle={() => setShowPassword((value) => !value)}
          />
        }
      />
      {errors.form && (
        <Notice tone="danger" role="alert">
          {errors.form}
        </Notice>
      )}
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Создаём аккаунт…" : "Создать аккаунт"}
        <span aria-hidden="true">↗</span>
      </Button>
      <AccountFormNote>
        Ваш email нужен только для аккаунта.
        <br />
        Пароль хранится в защищённом виде.
      </AccountFormNote>
      <AccountFormNote>
        Уже есть аккаунт? <ActionLink href="/login">Войти</ActionLink>
      </AccountFormNote>
    </AccountForm>
  );
}
