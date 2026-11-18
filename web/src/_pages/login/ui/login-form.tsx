"use client";

import { announceSessionChange, safeReturnTo } from "@/shared/auth";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AccountForm,
  AccountFormNote,
  ActionLink,
  Button,
  Notice,
  PasswordVisibilityToggle,
  TextField,
} from "@/shared/ui";
import { loginUser, LoginError } from "../api/login-user";
import { loginErrors, validateLogin, type LoginErrors } from "../model/login";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});
  const submitting = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (errors.form) errorRef.current?.focus();
  }, [errors]);

  function showErrors(next: LoginErrors, form: HTMLFormElement) {
    setErrors(next);
    const field = next.email ? "email" : next.password ? "password" : undefined;
    if (field) (form.elements.namedItem(field) as HTMLInputElement)?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const nextErrors = validateLogin(email, password);
    showErrors(nextErrors, form);
    if (Object.keys(nextErrors).length) return;
    submitting.current = true;
    setPending(true);
    try {
      await loginUser(email.trim(), password);
      setPassword("");
      setShowPassword(false);
      announceSessionChange();
      router.replace(
        safeReturnTo(
          new URLSearchParams(window.location.search).get("returnTo"),
        ),
      );
      router.refresh();
    } catch (error) {
      showErrors(
        loginErrors(
          error instanceof LoginError ? error.code : "internal_error",
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
        id="login-email"
        name="email"
        type="email"
        label="Email"
        placeholder="you@example.com"
        autoComplete="username"
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
        id="login-password"
        name="password"
        type={showPassword ? "text" : "password"}
        label="Пароль"
        placeholder="Ваш пароль"
        autoComplete="current-password"
        required
        value={password}
        readOnly={pending}
        error={errors.password}
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
            inputId="login-password"
            onToggle={() => setShowPassword((value) => !value)}
          />
        }
      />
      {errors.form && (
        <Notice tone="danger" role="alert" tabIndex={-1} ref={errorRef}>
          {errors.form}
        </Notice>
      )}
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Входим…" : "Войти"}
      </Button>
      <AccountFormNote>
        Нет аккаунта? <ActionLink href="/register">Создать аккаунт</ActionLink>
      </AccountFormNote>
    </AccountForm>
  );
}
