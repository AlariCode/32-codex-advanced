import type { FormEvent } from "react";
import { Button, TextField } from "@/shared/ui";
import styles from "./library.module.css";

type SaveLinkFormProps = {
  url: string;
  onURLChange: (url: string) => void;
  onSubmit: (event: FormEvent) => void;
};

export function SaveLinkForm({
  url,
  onURLChange,
  onSubmit,
}: SaveLinkFormProps) {
  return (
    <form onSubmit={onSubmit} noValidate className={styles.saveForm}>
      <TextField
        id="library-url"
        label="Ссылка на статью"
        type="text"
        inputMode="url"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="https://example.com/article"
        value={url}
        onChange={(event) => onURLChange(event.target.value)}
        hint="Адрес с http:// или https://"
      />
      <Button type="submit">
        Сохранить ссылку <span aria-hidden="true">↗</span>
      </Button>
    </form>
  );
}
