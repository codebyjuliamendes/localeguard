import type { CatalogInput } from '../domain/types.js';
import type { Repository } from './repository.js';

/** Demo workspace with intentional issues so the first scan has findings. */
export const DEMO_PROJECT = {
  name: 'Orbit Workspace',
  baseLocale: 'en-US',
  catalogs: [
    {
      locale: 'en-US',
      strings: {
        app_name: 'Orbit',
        'dashboard.title': 'Your workspace',
        'dashboard.welcome': 'Welcome back, {name}',
        'nav.settings': 'Settings',
        'nav.billing': 'Billing',
        'button.start_trial': 'Start free trial',
        'button.save_changes': 'Save changes',
        'table.empty': 'No projects yet',
        'trial.days_left': '{count} days left in your trial',
        'billing.renewal': 'Your plan renews on {date}',
        'notice.export': 'Export report',
        'notice.delete': 'Delete workspace',
      },
    },
    {
      locale: 'de-DE',
      strings: {
        app_name: 'Orbit',
        'dashboard.title': 'Ihr Arbeitsbereich',
        'dashboard.welcome': 'Willkommen zurück, {name}',
        'nav.settings': 'Einstellungen',
        'nav.billing': 'Abrechnung',
        'button.start_trial': 'Kostenlos testen',
        'button.save_changes': 'Änderungen speichern',
        'table.empty': 'Noch keine Projekte',
        'billing.renewal': 'Ihr Tarif verlängert sich am {date}',
        'notice.export': 'Bericht exportieren',
        'notice.delete': 'Arbeitsbereich löschen',
      },
    },
    {
      locale: 'ar-SA',
      strings: {
        app_name: 'أوربت',
        'dashboard.title': 'مساحة العمل',
        'dashboard.welcome': 'مرحبًا بعودتك، {name}',
        'nav.settings': 'الإعدادات',
        'nav.billing': 'الفوترة',
        'button.start_trial': 'ابدأ التجربة المجانية',
        'button.save_changes': 'حفظ التغييرات',
        'table.empty': 'لا توجد مشاريع بعد',
        'trial.days_left': 'تبقى {count} يومًا في الفترة التجريبية',
        'billing.renewal': 'تتجدد باقتك في {date}',
        'notice.export': 'تصدير التقرير',
        'notice.delete': 'حذف مساحة العمل',
      },
    },
  ] satisfies CatalogInput[],
  budgets: {
    app_name: 14,
    'dashboard.title': 24,
    'dashboard.welcome': 36,
    'nav.settings': 18,
    'nav.billing': 18,
    'button.start_trial': 20,
    'button.save_changes': 22,
    'table.empty': 30,
    'trial.days_left': 28,
    'billing.renewal': 40,
    'notice.export': 18,
    'notice.delete': 20,
  },
};

/** Seeds the demo project into an empty database; returns the new project id or null. */
export function seedDemo(repository: Repository): number | null {
  if (repository.projectCount() > 0) return null;
  return repository.createProject(DEMO_PROJECT);
}
