import { useMemo, type ReactNode } from "react";
import { createLowlight } from "lowlight";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import sql from "highlight.js/lib/languages/sql";
import type { RootContent } from "hast";
import styles from "./reader.module.css";

const lowlight = createLowlight({
  css,
  javascript,
  typescript,
  xml,
  json,
  bash,
  python,
  go,
  sql,
});
const labels: Record<string, string> = {
  css: "CSS",
  javascript: "JavaScript",
  typescript: "TypeScript",
  xml: "HTML / XML",
  json: "JSON",
  bash: "Shell",
  python: "Python",
  go: "Go",
  sql: "SQL",
};
function tokens(nodes: RootContent[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.value;
    if (node.type !== "element" || node.tagName !== "span") return null;
    const classes = Array.isArray(node.properties.className)
      ? node.properties.className
          .filter(
            (value) =>
              typeof value === "string" && /^hljs-[a-z0-9_-]+$/.test(value),
          )
          .join(" ")
      : "";
    return (
      <span key={index} className={classes}>
        {tokens(node.children)}
      </span>
    );
  });
}
export function CodeBlock({
  text,
  language,
}: {
  text: string;
  language?: string;
}) {
  const highlighted = useMemo(() => {
    // Preserve arbitrarily sized archived code without blocking the UI with
    // expensive language detection on large inputs or unsupported languages.
    if (text.length > 20_000 || (language && !lowlight.registered(language)))
      return null;
    try {
      return language
        ? lowlight.highlight(language, text)
        : lowlight.highlightAuto(text);
    } catch {
      return null;
    }
  }, [text, language]);
  const detected = highlighted?.data?.language;
  const label =
    (detected && labels[detected]) ||
    (language && labels[language]) ||
    language ||
    "Код";
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>{label}</div>
      <pre
        className={styles.code}
        tabIndex={0}
        aria-label={`Блок кода: ${label}`}
      >
        <code>{highlighted ? tokens(highlighted.children) : text}</code>
      </pre>
    </div>
  );
}
