import { useSettingsStore } from '@/lib/settings-store';
import en from './en.json';
import zhCN from './zh-CN.json';

export type Locale = 'en' | 'zh-CN';

const translations: Record<Locale, Record<string, unknown>> = {
  'en': en,
  'zh-CN': zhCN,
};

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return path;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : path;
}

export function useTranslation() {
  const locale = useSettingsStore((state) => state.locale);

  const t = (key: string, params?: Record<string, string | number>): string => {
    let value = getNestedValue(translations[locale], key);

    // Fall back to English if key not found in current locale
    if (value === key && locale !== 'en') {
      value = getNestedValue(translations['en'], key);
    }

    // Replace template parameters like {date}, {count}, {provider}
    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        value = value.replace(`{${paramKey}}`, String(paramValue));
      }
    }

    return value;
  };

  return { t, locale };
}
