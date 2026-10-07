export interface LoginErrors {
  email?: string;
  password?: string;
  form?: string;
}

export function validateLogin(email: string, password: string): LoginErrors {
  const errors: LoginErrors = {};
  const address = email.trim();
  if (!address) errors.email = "Введите email.";
  else if (!/^[^@]+@[^@\s]+$/.test(address) ||
    (!address.startsWith('"') && /\s/.test(address))) {
    errors.email = "Проверьте email. Например: reader@example.com.";
  }
  // Login checks existing credentials, not the registration password policy.
  if (!password) errors.password = "Введите пароль.";
  return errors;
}

export function loginErrors(code: string): LoginErrors {
  switch (code) {
    case "invalid_email": return { email: "Проверьте email. Например: reader@example.com." };
    case "invalid_password": return { password: "Введите пароль." };
    case "invalid_credentials": return { form: "Неверный email или пароль. Проверьте данные и попробуйте ещё раз." };
    case "request_too_large": return { form: "Данные формы слишком большие. Проверьте введённые данные." };
    case "invalid_request":
    case "unsupported_media_type": return { form: "Не удалось отправить форму. Обновите страницу и попробуйте ещё раз." };
    case "network_error": return { form: "Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз." };
    default: return { form: "Не удалось войти. Попробуйте ещё раз позже." };
  }
}
