import type { FormEvent } from "react";
import { Button, FieldAction, TextField } from "@/shared/ui";

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
    <form onSubmit={onSubmit} noValidate>
      <FieldAction>
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
        <Button type="submit">Сохранить ссылку</Button>
      </FieldAction>
    </form>
  );
}
