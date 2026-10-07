import Link from "next/link";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export function LoginPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Linkbook — на главную">
          <span className={styles.brandMark} aria-hidden="true">↗</span> linkbook
        </Link>
        <span className={styles.headerNote}>Личная библиотека ссылок</span>
      </header>
      <main className={styles.main}>
        <section className={styles.story} aria-labelledby="login-story-title">
          <span className={styles.eyebrow}>Рады видеть вас снова</span>
          <h1 id="login-story-title">Хорошие ссылки.<br />В одном месте.</h1>
          <p className={styles.intro}>Статьи, идеи и находки, к которым хочется вернуться. Войдите в свой аккаунт Linkbook.</p>
          <div className={styles.illustration} aria-hidden="true">
            <div className={styles.article}>
              <span>01 / ВЕРНУТЬСЯ К ВАЖНОМУ</span>
              <strong>Хорошие идеи<br />заслуживают продолжения.</strong>
              <div className={styles.articleLines}><i /><i /><i /></div>
              <span className={styles.articleArrow}>↗</span>
            </div>
            <div className={styles.articleBottom}><span>ВАША БИБЛИОТЕКА</span><span>＋</span></div>
          </div>
          <p className={styles.storyNote}>Своя коллекция. Свой ритм.</p>
        </section>
        <section className={styles.login} aria-labelledby="login-title">
          <div className={styles.formHeading}>
            <span className={styles.eyebrow}>С возвращением</span>
            <h2 id="login-title">Вход</h2>
            <p>Введите email и пароль своего аккаунта.</p>
          </div>
          <LoginForm />
        </section>
      </main>
      <footer className={styles.footer}><span>Linkbook / Своя коллекция. Свой ритм.</span><span>Сохранить. Прочитать. Вернуться.</span></footer>
    </div>
  );
}
