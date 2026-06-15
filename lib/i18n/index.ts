import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { en } from './locales/en';
import { ru } from './locales/ru';

/// Russian is the default UI language.
export const defaultLocale = 'ru';

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
