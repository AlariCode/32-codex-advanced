export interface RegistrationErrors {
  email?: string;
  password?: string;
  form?: string;
}

export function validateRegistration(email: string, password: string): RegistrationErrors {
  const errors: RegistrationErrors = {};
  const address = email.trim();
  if (!address) errors.email = "Введите email.";
  // Catch obvious typos without narrowing the API's supported email syntax.
  // Quoted local parts and domains without a dot remain the server's decision.
  else if (!/^[^@]+@[^@\s]+$/.test(address) ||
    (!address.startsWith('"') && /\s/.test(address))) {
    errors.email = "Проверьте email. Например: reader@example.com.";
  }
  // Count code points, as the Go API does.
  if (Array.from(password).length < 8) errors.password = "Пароль должен содержать минимум 8 символов.";
  return errors;
}

export function registrationErrors(code: string): RegistrationErrors {
  switch (code) {
    case "invalid_email": return { email: "Проверьте email. Например: reader@example.com." };
    case "invalid_password": return { password: "Пароль должен содержать минимум 8 символов." };
    case "email_exists": return { email: "Аккаунт с этим email уже существует. Используйте другой адрес." };
    case "request_too_large": return { form: "Данные формы слишком большие. Используйте более короткий пароль." };
    case "invalid_request":
    case "unsupported_media_type": return { form: "Не удалось отправить форму. Обновите страницу и попробуйте ещё раз." };
    case "network_error": return { form: "Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз." };
    default: return { form: "Не удалось создать аккаунт. Попробуйте ещё раз позже." };
  }
}
