"use client";

import { useId, useState } from "react";
import {
  AccountForm,
  AccountFormNote,
  Button,
  Notice,
  TextField,
} from "@/shared/ui";

export function AccountFormExample() {
  const emailId = useId();
  const [submitted, setSubmitted] = useState(false);

  return (
    <AccountForm
      aria-label="Пример формы аккаунта"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      <TextField
        id={emailId}
        label="Email"
        type="email"
        placeholder="you@example.com"
        required
        onChange={() => setSubmitted(false)}
      />
      <AccountFormNote>
        Учебная форма. Введённый адрес никуда не отправляется.
      </AccountFormNote>
      <Button type="submit">Проверить форму</Button>
      {submitted && (
        <Notice tone="success" role="status">
          Форма заполнена.
        </Notice>
      )}
    </AccountForm>
  );
}
