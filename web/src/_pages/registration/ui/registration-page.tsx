import Link from "next/link";
import { RegistrationForm } from "./registration-form";
import styles from "./registration.module.css";

export function RegistrationPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Linkbook — на главную">
          <span className={styles.brandMark} aria-hidden="true">↗</span> linkbook
        </Link>
        <span className={styles.headerNote}>Личная библиотека ссылок</span>
      </header>
      <main className={styles.main}>
        <section className={styles.story} aria-labelledby="story-title">
          <span className={styles.eyebrow}>Сохраняйте то, что важно</span>
          <h1 id="story-title">Хорошие ссылки.<br />В одном месте.</h1>
          <p className={styles.intro}>Статьи, идеи и находки, к которым хочется вернуться. Начните свою коллекцию с Linkbook.</p>
          <div className={styles.illustration} aria-hidden="true">
            <div className={styles.article}><span>01 / СОХРАНИТЬ НА ПОТОМ</span><strong>Меньше открытых вкладок.<br />Больше хороших идей.</strong><div className={styles.articleLines}><i /><i /><i /></div><span className={styles.articleArrow}>↗</span></div>
            <div className={styles.articleBottom}><span>ВАША БИБЛИОТЕКА</span><span>＋</span></div>
          </div>
          <p className={styles.storyNote}>Собирайте сегодня. Возвращайтесь, когда удобно.</p>
        </section>
        <section className={styles.registration} aria-labelledby="registration-title">
          <div className={styles.formHeading}><span className={styles.eyebrow}>Начнём с аккаунта</span><h2 id="registration-title">Регистрация</h2><p>Всего два поля — и ваш аккаунт готов.</p></div>
          <RegistrationForm />
        </section>
      </main>
      <footer className={styles.footer}><span>Linkbook / Своя коллекция. Свой ритм.</span><span>Сохранить. Прочитать. Вернуться.</span></footer>
    </div>
  );
}
