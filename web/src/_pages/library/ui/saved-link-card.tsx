import Link from "next/link";
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
  serverNow: number;
  retryError?: string;
  retrying: boolean;
  opening: string | null;
  retry: (card: LinkCard) => void;
  openCard: (id: string) => void;
};

export function SavedLinkCard({
  card,
  serverNow,
  retryError,
  retrying,
  opening,
  retry,
  openCard,
}: SavedLinkCardProps) {
  return (
    <article
      id={`link-${card.id}`}
      tabIndex={-1}
      className={styles.card}
      aria-label={`Сохранённая ссылка ${card.submitted_url}`}
    >
      <p className={styles.eyebrow} role="status">
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
      </p>
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
      {retryError && <p role="alert">{retryError}</p>}
      <div className={styles.actions}>
        {(card.state === "failed" || card.state === "unavailable") && (
          <button disabled={!!retrying} onClick={() => void retry(card)}>
            {retrying ? "Отправляем повтор…" : "Повторить"}
          </button>
        )}
        {card.state === "ready" && card.can_read !== false && (
          <Link href={`/links/${card.id}`}>Читать статью</Link>
        )}

        {card.state !== "ready" && (
          <button
            disabled={opening !== null}
            onClick={() => {
              void openCard(card.id);
            }}
          >
            {opening === card.id ? "Открываем…" : "Открыть карточку"}
          </button>
        )}
        <a href={card.submitted_url} target="_blank" rel="noopener noreferrer">
          Открыть оригинал <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}
