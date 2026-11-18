import { useRef, useState } from "react";
import {
  ActionLink,
  ExternalActionLink,
  ActionRow,
  Button,
  ConfirmationPanel,
  Notice,
  StatusLabel,
} from "@/shared/ui";
import type { LinkCard } from "../model/library";
import styles from "./library.module.css";

function processingReason(reason?: string | null) {
  return (
    (
      {
        article_unavailable:
          "На странице нет доступного текста статьи: это может быть главная, видео, PDF или страница входа/оплаты. Откройте оригинал или повторите позже.",
        destination_blocked: "Этот адрес недоступен для безопасной загрузки.",
        network_error: "Не удалось связаться с сайтом.",
        http_error: "Сайт не отдал страницу.",
        html_too_large: "Страница превышает допустимый размер.",
        unsupported_content: "По этому адресу нет HTML-страницы.",
        redirect_limit: "Сайт перенаправляет слишком много раз.",
        processing_error: "Не удалось обработать текст статьи.",
        timeout:
          "Не удалось обработать ссылку за две минуты. Откройте оригинал.",
      } as Record<string, string>
    )[reason ?? ""] ?? "Не удалось обработать ссылку."
  );
}

type SavedLinkCardProps = {
  card: LinkCard;
  deleting: boolean;
  deleteError?: string;
  remove: (id: string) => Promise<void>;
  serverNow: number;
  retryError?: string;
  retrying: boolean;
  opening: string | null;
  retry: (card: LinkCard) => void;
  openCard: (id: string) => void;
};

export function SavedLinkCard({
  card,
  deleting,
  deleteError,
  remove,
  serverNow,
  retryError,
  retrying,
  opening,
  retry,
  openCard,
}: SavedLinkCardProps) {
  const [confirming, setConfirming] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  function cancel() {
    setConfirming(false);
    requestAnimationFrame(() => deleteButton.current?.focus());
  }
  const tone = {
    processing: "neutral",
    ready: "success",
    unavailable: "warning",
    failed: "danger",
  } as const;
  return (
    <article
      id={`link-${card.id}`}
      tabIndex={-1}
      className={styles.card}
      aria-label={`Сохранённая ссылка ${card.submitted_url}`}
    >
      <StatusLabel tone={tone[card.state]} role="status">
        {
          {
            processing:
              serverNow - Date.parse(card.requested_at) >= 30_000
                ? "Обработка занимает больше времени"
                : "Обрабатываем",
            ready: "Готово",
            unavailable: "Текст статьи недоступен",
            failed: "Ошибка обработки",
          }[card.state]
        }
      </StatusLabel>
      {card.title && <h2>{card.title}</h2>}
      <p className={styles.address}>{card.submitted_url}</p>
      {(card.state === "failed" || card.state === "unavailable") && (
        <p>
          {processingReason(
            card.reason ??
              (card.state === "unavailable" ? "article_unavailable" : null),
          )}
        </p>
      )}
      {retryError && (
        <Notice tone="danger" role="alert">
          {retryError}
        </Notice>
      )}
      {deleteError && (
        <Notice tone="danger" role="alert">
          {deleteError}
        </Notice>
      )}
      {deleting && (
        <Notice tone="neutral" role="status">
          Удаляем… Проверяем результат на сервере.
        </Notice>
      )}
      {confirming && !deleting && (
        <ConfirmationPanel
          className={styles.deleteConfirmation}
          role="group"
          aria-label="Подтверждение удаления"
          onKeyDown={(event) => {
            if (event.key === "Escape") cancel();
          }}
        >
          <p>
            Удалить ссылку и сохранённую статью навсегда? Обработка остановится.
            Восстановить их не получится.
          </p>
          <ActionRow>
            <Button variant="secondary" autoFocus onClick={cancel}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                void remove(card.id);
              }}
            >
              Удалить навсегда
            </Button>
          </ActionRow>
        </ConfirmationPanel>
      )}
      <ActionRow>
        {(card.state === "failed" || card.state === "unavailable") && (
          <Button
            variant="text"
            disabled={!!retrying || deleting}
            aria-busy={retrying}
            onClick={() => void retry(card)}
          >
            {retrying ? "Отправляем повтор…" : "Повторить"}
          </Button>
        )}
        {card.state === "ready" && card.can_read !== false && (
          <ActionLink variant="secondary" href={`/links/${card.id}`}>
            Читать статью
          </ActionLink>
        )}

        {card.state !== "ready" && (
          <Button
            variant="text"
            disabled={opening !== null || deleting}
            aria-busy={opening === card.id}
            onClick={() => {
              void openCard(card.id);
            }}
          >
            {opening === card.id ? "Открываем…" : "Открыть карточку"}
          </Button>
        )}
        <ExternalActionLink href={card.submitted_url}>
          Открыть оригинал
        </ExternalActionLink>
        <Button
          variant="dangerText"
          ref={deleteButton}
          disabled={deleting || confirming}
          onClick={() => setConfirming(true)}
        >
          {deleting
            ? "Удаляем…"
            : deleteError
              ? "Повторить удаление"
              : "Удалить"}
        </Button>
      </ActionRow>
    </article>
  );
}
