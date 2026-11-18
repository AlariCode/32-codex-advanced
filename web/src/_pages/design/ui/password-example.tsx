"use client";

import { useState } from "react";
import { PasswordVisibilityToggle, TextField } from "@/shared/ui";

export function PasswordExample() {
  const [visible, setVisible] = useState(false);
  const id = "design-password";

  return (
    <TextField
      id={id}
      label="Пароль"
      type={visible ? "text" : "password"}
      defaultValue="linkbook-example"
      autoComplete="off"
      action={
        <PasswordVisibilityToggle
          visible={visible}
          disabled={false}
          inputId={id}
          onToggle={() => setVisible((value) => !value)}
        />
      }
    />
  );
}
