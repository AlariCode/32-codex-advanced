import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./account-layout.module.css";

interface AccountLayoutProps {
  story: {
    titleId: string;
    eyebrow: string;
    intro: string;
    articleLabel: string;
    articleTitle: ReactNode;
    note: string;
  };
  heading: {
    titleId: string;
    eyebrow: string;
    title: string;
    description: string;
  };
  children: ReactNode;
}

export function AccountLayout({ story, heading, children }: AccountLayoutProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Linkbook — на главную">
          <span className={styles.brandMark} aria-hidden="true">↗</span> linkbook
        </Link>
        <span className={styles.headerNote}>Личная библиотека ссылок</span>
      </header>
      <main className={styles.main}>
        <section className={styles.story} aria-labelledby={story.titleId}>
          <span className={styles.eyebrow}>{story.eyebrow}</span>
          <h1 id={story.titleId}>Хорошие ссылки.<br />В одном месте.</h1>
          <p className={styles.intro}>{story.intro}</p>
          <div className={styles.illustration} aria-hidden="true">
            <div className={styles.article}>
              <span>{story.articleLabel}</span>
              <strong>{story.articleTitle}</strong>
              <div className={styles.articleLines}><i /><i /><i /></div>
              <span className={styles.articleArrow}>↗</span>
            </div>
            <div className={styles.articleBottom}><span>ВАША БИБЛИОТЕКА</span><span>＋</span></div>
          </div>
          <p className={styles.storyNote}>{story.note}</p>
        </section>
        <section className={styles.account} aria-labelledby={heading.titleId}>
          <div className={styles.formHeading}>
            <span className={styles.eyebrow}>{heading.eyebrow}</span>
            <h2 id={heading.titleId}>{heading.title}</h2>
            <p>{heading.description}</p>
          </div>
          {children}
        </section>
      </main>
      <footer className={styles.footer}><span>Linkbook / Своя коллекция. Свой ритм.</span><span>Сохранить. Прочитать. Вернуться.</span></footer>
    </div>
  );
}
