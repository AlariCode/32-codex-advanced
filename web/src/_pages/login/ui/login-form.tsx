"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, TextField } from "@/shared/ui";
import { loginUser, LoginError, type LoggedInUser } from "../api/login-user";
import { loginErrors, validateLogin, type LoginErrors } from "../model/login";
import styles from "./login.module.css";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});
  const [user, setUser] = useState<LoggedInUser | null>(null);
  const submitting = useRef(false);
  const successRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (user) successRef.current?.focus();
  }, [user]);

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
      const authenticated = await loginUser(email.trim(), password);
      setPassword("");
      setShowPassword(false);
      setUser(authenticated);
    } catch (error) {
      showErrors(loginErrors(error instanceof LoginError ? error.code : "internal_error"), form);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (user) return (
    <div className={styles.success} role="status" tabIndex={-1} ref={successRef}>
      <span className={styles.successMark} aria-hidden="true">✓</span>
      <h3>Вход выполнен</h3>
      <p>Вы вошли с адресом <strong>{user.email}</strong>.</p>
      <Link href="/" className={styles.homeLink}>На главную <span aria-hidden="true">↗</span></Link>
    </div>
  );

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate aria-busy={pending}>
      <TextField
        id="login-email" name="email" type="email" label="Email" placeholder="you@example.com"
        autoComplete="username" autoCapitalize="none" spellCheck={false} required
        value={email} readOnly={pending} error={errors.email}
        onChange={event => { setEmail(event.target.value); setErrors(current => ({ ...current, email: undefined, form: undefined })); }}
      />
      <TextField
        id="login-password" name="password" type={showPassword ? "text" : "password"}
        label="Пароль" placeholder="Ваш пароль" autoComplete="current-password" required
        value={password} readOnly={pending} error={errors.password}
        onChange={event => { setPassword(event.target.value); setErrors(current => ({ ...current, password: undefined, form: undefined })); }}
        action={
          <button
            type="button" className={styles.passwordToggle}
            aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
            aria-pressed={showPassword} aria-controls="login-password" disabled={pending}
            onClick={() => setShowPassword(value => !value)}
          >{showPassword ? "Скрыть" : "Показать"}</button>
        }
      />
      {errors.form && <p className={styles.formError} role="alert" tabIndex={-1} ref={errorRef}>{errors.form}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Входим…" : "Войти"}<span aria-hidden="true">↗</span>
      </Button>
      <p className={styles.formNote}>Нет аккаунта? <Link href="/register" className={styles.accountLink}>Создать аккаунт</Link></p>
    </form>
  );
}
