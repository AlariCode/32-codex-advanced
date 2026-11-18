import type { CSSProperties } from "react";
import {
  ActionLink,
  Button,
  ConfirmationPanel,
  Notice,
  TextField,
} from "@/shared/ui";
import { AccountFormExample } from "./account-form-example";
import { colorGroups, typeScale } from "./design-tokens";
import { PasswordExample } from "./password-example";
import styles from "./design.module.css";

export function DesignPage() {
  return (
    <div className={styles.page} id="top">
      <header className={styles.header}>
        <span className={styles.brand}>Linkbook</span>
        <nav aria-label="Разделы дизайн-системы">
          <ActionLink href="#colors">Цвета</ActionLink>
          <ActionLink href="#typography">Типографика</ActionLink>
          <ActionLink href="#components">Компоненты</ActionLink>
        </nav>
      </header>
      <main className={styles.main}>
        <div className={styles.intro}>
          <h1>Дизайн-система</h1>
          <p>Токены и живые примеры компонентов Linkbook.</p>
        </div>

        <section
          className={styles.section}
          id="colors"
          aria-labelledby="colors-title"
        >
          <h2 id="colors-title">Цвета</h2>
          {colorGroups.map(([group, colors]) => (
            <div key={group}>
              <h3>{group}</h3>
              <ul className={styles.swatches}>
                {colors.map(([name, role]) => {
                  const token = `--color-${role}`;
                  return (
                    <li key={role}>
                      <div
                        className={styles.swatch}
                        style={{ backgroundColor: `var(${token})` }}
                      />
                      <span>{name}</span>
                      <code>{token}</code>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

        <section
          className={styles.section}
          id="typography"
          aria-labelledby="typography-title"
        >
          <h2 id="typography-title">Типографика</h2>
          <div className={styles.familyGrid}>
            <div>
              <h3>Inter Variable</h3>
              <p>Кириллица и латиница, начертания 400, 500 и 600, курсив.</p>
              <code>--font-ui · --font-heading · --font-reading</code>
              <p className={styles.weights}>
                Обычный · <span>Средний</span> · <strong>Полужирный</strong> ·{" "}
                <em>Курсив</em>
              </p>
            </div>
            <div>
              <h3>Системный моноширинный</h3>
              <p>Код и технические идентификаторы.</p>
              <code>--font-code</code>
              <p>
                <code>const title = &quot;Linkbook&quot;;</code>
              </p>
            </div>
          </div>
          <ul className={styles.scale}>
            {typeScale.map(({ name, token, style }) => (
              <li key={token}>
                <span>
                  {name}
                  <code>{token}</code>
                </span>
                <p
                  className={styles[style]}
                  style={{ "--example-size": `var(${token})` } as CSSProperties}
                >
                  Статьи, к которым хочется вернуться
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section
          className={styles.section}
          id="components"
          aria-labelledby="components-title"
        >
          <h2 id="components-title">Компоненты</h2>
          <div>
            <h3>Кнопки и ссылки</h3>
            <div className={styles.preview}>
              <div className={styles.actions}>
                <Button>Основная</Button>
                <Button variant="secondary">Вторичная</Button>
                <Button variant="danger">Деструктивная</Button>
                <Button variant="text">Текстовая</Button>
                <Button variant="dangerText">Удалить</Button>
                <Button disabled>Недоступна</Button>
                <Button aria-busy="true" disabled>
                  Сохраняем…
                </Button>
              </div>
              <div className={styles.actions}>
                <ActionLink variant="primary" href="#colors">
                  К цветам
                </ActionLink>
                <ActionLink href="#typography">К типографике</ActionLink>
              </div>
            </div>
          </div>
          <div>
            <h3>Поля ввода</h3>
            <div className={`${styles.preview} ${styles.fieldGrid}`}>
              <TextField
                id="design-email"
                type="email"
                label="Email"
                placeholder="you@example.com"
                hint="Адрес для входа в аккаунт."
              />
              <TextField
                id="design-invalid"
                label="Адрес статьи"
                defaultValue="example"
                error="Введите полный URL статьи."
              />
              <TextField
                id="design-read-only"
                label="Только чтение"
                readOnly
                defaultValue="Linkbook"
              />
              <TextField
                id="design-disabled"
                label="Недоступное поле"
                disabled
                defaultValue="Linkbook"
              />
              <PasswordExample />
            </div>
          </div>
          <div>
            <h3>Уведомления</h3>
            <div className={styles.preview}>
              <Notice tone="success">Ссылка сохранена в библиотеке.</Notice>
              <Notice tone="warning">
                Архив статьи доступен без некоторых изображений.
              </Notice>
              <Notice tone="danger">
                Не удалось сохранить ссылку. Повторите попытку.
              </Notice>
            </div>
          </div>
          <div>
            <h3>Подтверждение действия</h3>
            <ConfirmationPanel
              role="group"
              aria-label="Пример подтверждения удаления"
            >
              <p>Удалить ссылку из библиотеки?</p>
              <div className={styles.actions}>
                <Button variant="secondary">Отмена</Button>
                <Button variant="danger">Удалить навсегда</Button>
              </div>
            </ConfirmationPanel>
          </div>
          <div>
            <h3>Форма аккаунта</h3>
            <div className={styles.preview}>
              <AccountFormExample />
              <div className={styles.actions}>
                <ActionLink href="/login">Макет входа</ActionLink>
                <ActionLink href="/register">Макет регистрации</ActionLink>
              </div>
            </div>
          </div>
        </section>
        <footer className={styles.footer}>
          <ActionLink href="#top">К началу страницы ↑</ActionLink>
        </footer>
      </main>
    </div>
  );
}
