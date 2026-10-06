"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, TextField } from "@/shared/ui";
import { registerUser, RegistrationError, type RegisteredUser } from "../api/register-user";
import { registrationErrors, validateRegistration, type RegistrationErrors } from "../model/registration";
import styles from "./registration.module.css";

export function RegistrationForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [user, setUser] = useState<RegisteredUser | null>(null);
  const submitting = useRef(false);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) successRef.current?.focus();
  }, [user]);

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
      const registered = await registerUser(email.trim(), password);
      setPassword("");
      setUser(registered);
    } catch (error) {
      showErrors(registrationErrors(error instanceof RegistrationError ? error.code : "internal_error"), form);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (user) return (
    <div className={styles.success} role="status" tabIndex={-1} ref={successRef}>
      <span className={styles.successMark} aria-hidden="true">✓</span>
      <h3>Аккаунт создан</h3>
      <p>Вы зарегистрированы с адресом <strong>{user.email}</strong>.</p>
      <p className={styles.formNote}>Вход и библиотека появятся в следующих обновлениях.</p>
      <Link href="/" className={styles.homeLink}>На главную <span aria-hidden="true">↗</span></Link>
    </div>
  );

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate aria-busy={pending}>
      <TextField id="registration-email" name="email" type="email" label="Email" placeholder="you@example.com" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={email} readOnly={pending} error={errors.email} onChange={event => { setEmail(event.target.value); setErrors(current => ({ ...current, email: undefined, form: undefined })); }} />
      <TextField id="registration-password" name="password" type={showPassword ? "text" : "password"} label="Пароль" placeholder="Придумайте пароль" autoComplete="new-password" required value={password} readOnly={pending} error={errors.password} hint="Минимум 8 символов. Можно использовать пробелы." onChange={event => { setPassword(event.target.value); setErrors(current => ({ ...current, password: undefined, form: undefined })); }} action={<button type="button" className={styles.passwordToggle} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"} aria-pressed={showPassword} aria-controls="registration-password" disabled={pending} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Скрыть" : "Показать"}</button>} />
      {errors.form && <p className={styles.formError} role="alert">{errors.form}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Создаём аккаунт…" : "Создать аккаунт"}<span aria-hidden="true">↗</span></Button>
      <p className={styles.formNote}>Ваш email нужен только для аккаунта.<br />Пароль хранится в защищённом виде.</p>
    </form>
  );
}
