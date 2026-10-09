import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { en } from './locales/en';
import { ru } from './locales/ru';

/// Russian is the default UI language.
export const defaultLocale = 'ru';
export type AppLocale = 'ru' | 'en';
export function currentLocale(): AppLocale {
  return i18n.resolvedLanguage?.startsWith('en') ? 'en' : defaultLocale;
}
export function speechLocale(): string {
  return currentLocale() === 'en' ? 'en-US' : 'ru-RU';
}

void i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: defaultLocale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
