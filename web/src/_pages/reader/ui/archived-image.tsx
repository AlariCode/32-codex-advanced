"use client";
import { useState } from "react";
import type { Block } from "../api/document";
import styles from "./reader.module.css";

const reasons: Record<string, string> = {
  image_too_large: "размер больше 5 MiB",
  image_total_limit: "достигнут общий предел 20 MiB",
  image_count_limit: "достигнут предел 50 изображений",
  image_invalid: "формат повреждён или не поддерживается",
  image_source_unsupported: "адрес изображения не поддерживается",
  image_fetch_failed: "источник недоступен для безопасной загрузки",
};
export function ArchivedImage({
  block,
  linkID,
  revalidate,
}: {
  block: Block;
  linkID: string;
  revalidate: () => void;
}) {
  const [failed, setFailed] = useState(false);
  if (!block.asset_id || failed)
    return (
      <span className={styles.imagePlaceholder} role="note">
        Изображение {block.alt ? `«${block.alt}» ` : ""}не сохранено:{" "}
        {failed
          ? "сохранённое изображение недоступно"
          : (reasons[block.omission ?? ""] ?? "изображение недоступно")}
        .
      </span>
    );
  // The private same-origin endpoint serves verified bytes without Next's image cache.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.archivedImage}
      src={`/api/links/${encodeURIComponent(linkID)}/assets/${block.asset_id}`}
      alt={block.alt ?? ""}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(true);
        revalidate();
      }}
    />
  );
}
