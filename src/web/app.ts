import type { CatalogDto, Coverage, Issue, ProjectResponse } from '../http/contract.js';
import { api, ApiError } from './api.js';
import { byId, h, replaceChildren } from './dom.js';
import { countBySeverity, coverageLabel, flagFor, formatTimestamp, localeHealth, localeLabel, lookupString, pluralize } from './format.js';

const THEME_KEY = 'localeguard:theme';
const MAX_RENDERED_ISSUES = 250;
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'yi', 'dv', 'ckb', 'sd', 'ug']);

const els = {
  scan: byId('scan', HTMLButtonElement),
  scanLabel: byId('scan-label'),
  banner: byId('banner'),
  bannerText: byId('banner-text'),
  retry: byId('retry', HTMLButtonElement),
  projectName: byId('project-name'),
  projectDesc: byId('project-desc'),
  sync: byId('sync'),
  updated: byId('updated'),
  addLocale: byId('add-locale', HTMLButtonElement),
  localeList: byId('locale-list', HTMLUListElement),
  scanTime: byId('scan-time'),
  scanStatus: byId('scan-status'),
  blocking: byId('blocking'),
  warnings: byId('warnings'),
  coverage: byId('coverage'),
  findingCount: byId('finding-count'),
  issues: byId('issues', HTMLUListElement),
  localeSelect: byId('locale-select', HTMLSelectElement),
  editorLocale: byId('editor-locale'),
  editor: byId('editor', HTMLTextAreaElement),
  editStatus: byId('edit-status'),
  save: byId('save', HTMLButtonElement),
  themeToggle: byId('theme-toggle', HTMLButtonElement),
  dialog: byId('locale-dialog', HTMLDialogElement),
  localeForm: byId('locale-form', HTMLFormElement),
  newLocale: byId('new-locale', HTMLInputElement),
  newLocaleHint: byId('new-locale-hint'),
  localeCancel: byId('locale-cancel', HTMLButtonElement),
  localeSubmit: byId('locale-submit', HTMLButtonElement),
};

interface State {
  project: ProjectResponse | null;
  issues: Issue[];
  selected: string | null;
  dirty: boolean;
  busy: boolean;
}

const state: State = { project: null, issues: [], selected: null, dirty: false, busy: false };

const directionOf = (locale: string): 'rtl' | 'ltr' => (RTL_LANGUAGES.has(locale.split('-')[0] ?? '') ? 'rtl' : 'ltr');
const catalogFor = (locale: string | null): CatalogDto | undefined => state.project?.catalogs.find((catalog) => catalog.locale === locale);
const errorMessage = (error: unknown): string =>
  error instanceof ApiError
    ? [error.message, ...error.details.slice(0, 3)].join(' ')
    : error instanceof Error
      ? error.message
      : String(error);

/* ---------- theme ---------- */

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function effectiveTheme(): 'light' | 'dark' {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return darkQuery.matches ? 'dark' : 'light';
}
function syncThemeToggle(): void {
  els.themeToggle.setAttribute('aria-pressed', String(effectiveTheme() === 'dark'));
}
els.themeToggle.addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Not persisted when storage is blocked; the choice still applies to this page.
  }
  syncThemeToggle();
});
darkQuery.addEventListener('change', syncThemeToggle);
syncThemeToggle();

/* ---------- busy / feedback ---------- */

function setBusy(busy: boolean, label?: string): void {
  state.busy = busy;
  const ready = Boolean(state.project);
  els.scan.disabled = busy || !ready;
  els.save.disabled = busy || !ready || !state.selected;
  els.addLocale.disabled = busy || !ready;
  els.localeSelect.disabled = busy || !ready;
  els.editor.disabled = !ready || !state.selected;
  els.localeSubmit.disabled = busy;
  els.scan.setAttribute('aria-busy', String(busy));
  els.scanLabel.textContent = busy && label ? label : 'Run quality scan';
}

function showBanner(message: string | null): void {
  els.banner.hidden = message === null;
  els.bannerText.textContent = message ?? '';
}

function setEditStatus(message: string, tone: 'info' | 'error' | 'success' = 'info'): void {
  els.editStatus.textContent = message;
  els.editStatus.dataset.tone = tone;
  els.editStatus.setAttribute('role', tone === 'error' ? 'alert' : 'status');
}

/* ---------- rendering ---------- */

function renderProject(): void {
  const project = state.project;
  if (!project) return;
  const { baseLocale, name } = project.project;
  els.projectName.textContent = name;
  els.projectDesc.textContent = `Product UI · ${pluralize(project.catalogs.length, 'locale')} · ${localeLabel(baseLocale)} source`;
  const newest = project.catalogs
    .map((catalog) => catalog.updatedAt)
    .sort()
    .at(-1);
  els.sync.dataset.state = 'ok';
  els.updated.textContent = newest ? `Catalogs synced · updated ${formatTimestamp(newest)}` : 'Catalogs synced';

  if (!state.selected || !catalogFor(state.selected)) {
    state.selected = project.catalogs.find((catalog) => catalog.locale !== baseLocale)?.locale ?? project.catalogs[0]?.locale ?? null;
  }
  replaceChildren(
    els.localeSelect,
    project.catalogs.map((catalog) =>
      h(
        'option',
        { value: catalog.locale, selected: catalog.locale === state.selected },
        `${catalog.locale} · ${localeLabel(catalog.locale)}${catalog.locale === baseLocale ? ' (source)' : ''}`,
      ),
    ),
  );
  renderLocales();
}

const HEALTH_TEXT = { source: 'SOURCE', blocking: 'BLOCKING', review: 'REVIEW', healthy: 'HEALTHY' } as const;
const HEALTH_DOT = { source: 'ok', blocking: 'bad', review: 'warn', healthy: 'ok' } as const;

function renderLocales(): void {
  const project = state.project;
  if (!project) return;
  const { baseLocale } = project.project;
  els.localeList.setAttribute('aria-busy', 'false');
  if (!project.catalogs.length) {
    replaceChildren(els.localeList, [h('li', { class: 'placeholder-row' }, 'No catalogs yet. Add a locale to start.')]);
    return;
  }
  replaceChildren(
    els.localeList,
    project.catalogs.map((catalog) => {
      const health = localeHealth(catalog.locale, baseLocale, state.issues);
      const keys = countKeys(catalog.strings);
      const meta = [catalog.locale, catalog.direction === 'rtl' ? 'RTL' : '', catalog.locale === baseLocale ? 'Source' : '']
        .filter(Boolean)
        .join(' · ');
      const button = h(
        'button',
        { type: 'button', class: 'locale-row', 'data-locale': catalog.locale, 'aria-pressed': String(catalog.locale === state.selected) },
        h('span', { class: 'flag', 'aria-hidden': 'true' }, flagFor(catalog.locale)),
        h(
          'span',
          { class: 'locale-meta' },
          h('span', { class: 'locale-name' }, localeLabel(catalog.locale)),
          h('span', { class: 'locale-code' }, meta),
        ),
        h(
          'span',
          { class: 'locale-health' },
          h('b', {}, h('span', { class: `dot ${HEALTH_DOT[health]}`, 'aria-hidden': 'true' }), HEALTH_TEXT[health]),
          h('small', {}, pluralize(keys, 'key')),
        ),
      );
      button.addEventListener('click', () => selectLocale(catalog.locale));
      return h('li', {}, button);
    }),
  );
}

function countKeys(tree: Record<string, unknown>): number {
  let count = 0;
  for (const value of Object.values(tree)) {
    if (typeof value === 'string') count++;
    else if (value && typeof value === 'object') count += countKeys(value as Record<string, unknown>);
  }
  return count;
}

const ICON = { blocker: '×', warning: '!', info: 'i' } as const;

function renderIssue(issue: Issue): HTMLLIElement {
  const catalog = catalogFor(issue.locale);
  const value = catalog && issue.key !== '__direction__' ? lookupString(catalog.strings, issue.key) : undefined;
  return h(
    'li',
    { class: 'issue', 'data-severity': issue.severity },
    h('span', { class: 'issue-icon', 'aria-hidden': 'true' }, ICON[issue.severity]),
    h(
      'div',
      { class: 'issue-body' },
      h('p', { class: 'issue-title' }, issue.kind, ' ', h('span', { class: 'issue-locale' }, `· ${issue.locale}`)),
      h('p', { class: 'issue-detail' }, issue.detail, ' ', h('code', {}, issue.key)),
      value
        ? h(
            'p',
            { class: 'issue-preview' },
            h('span', { class: 'visually-hidden' }, 'Current text: '),
            // bdi + dir/lang keep RTL text correctly ordered inside the LTR dashboard.
            h('bdi', { lang: issue.locale, dir: catalog?.direction ?? directionOf(issue.locale) }, value),
          )
        : null,
    ),
    h('span', { class: 'issue-tag' }, issue.severity.toUpperCase()),
  );
}

function renderScan(issues: Issue[], coverage: Coverage | null, createdAt: string | null): void {
  state.issues = issues;
  const counts = countBySeverity(issues);
  els.blocking.textContent = String(counts.blocker);
  els.warnings.textContent = String(counts.warning);
  els.coverage.textContent = coverageLabel(coverage ?? state.project?.coverage);
  els.findingCount.textContent = `${pluralize(issues.length, 'result')}${counts.info ? ` · ${counts.info} notice${counts.info === 1 ? '' : 's'}` : ''}`;
  els.scanTime.textContent = createdAt ? `Completed ${formatTimestamp(createdAt)}` : 'Not scanned yet';
  const actionable = counts.blocker + counts.warning;
  els.scanStatus.dataset.state = counts.blocker ? 'blocking' : actionable ? 'issues' : 'clear';
  els.scanStatus.textContent = counts.blocker ? '● BLOCKING ISSUES' : actionable ? '● ISSUES FOUND' : '● ALL CLEAR';
  els.issues.setAttribute('aria-busy', 'false');

  if (!issues.length) {
    replaceChildren(els.issues, [
      h(
        'li',
        { class: 'issue', 'data-severity': 'ok' },
        h('span', { class: 'issue-icon', 'aria-hidden': 'true' }, '✓'),
        h(
          'div',
          { class: 'issue-body' },
          h('p', { class: 'issue-title' }, 'Your catalogs look great'),
          h('p', { class: 'issue-detail' }, 'No localization quality issues detected.'),
        ),
      ),
    ]);
  } else {
    const shown = issues.slice(0, MAX_RENDERED_ISSUES).map(renderIssue);
    if (issues.length > MAX_RENDERED_ISSUES) {
      shown.push(
        h(
          'li',
          { class: 'placeholder-row' },
          `${issues.length - MAX_RENDERED_ISSUES} more findings hidden; use the CLI with --format json for the full list.`,
        ),
      );
    }
    replaceChildren(els.issues, shown);
  }
  renderLocales();
}

function fillEditor(): void {
  const catalog = catalogFor(state.selected);
  if (!catalog) {
    els.editorLocale.textContent = '—';
    els.editor.value = '';
    return;
  }
  els.editorLocale.textContent = catalog.locale;
  els.editor.lang = catalog.locale;
  els.editor.value = JSON.stringify(catalog.strings, null, 2);
  els.editor.removeAttribute('aria-invalid');
  els.localeSelect.value = catalog.locale;
  state.dirty = false;
}

/* ---------- actions ---------- */

function selectLocale(locale: string): void {
  if (locale === state.selected) return;
  if (state.dirty && !window.confirm(`Discard unsaved changes to ${state.selected ?? 'this catalog'}?`)) {
    els.localeSelect.value = state.selected ?? '';
    return;
  }
  state.selected = locale;
  fillEditor();
  renderLocales();
  setBusy(state.busy);
}

async function loadProject(id: number): Promise<void> {
  state.project = await api.project(id);
  renderProject();
}

async function runScan(): Promise<void> {
  const project = state.project;
  if (!project || state.busy) return;
  setBusy(true, 'Scanning…');
  try {
    const result = await api.scan(project.project.id);
    renderScan(result.issues, result.coverage, result.createdAt);
    showBanner(null);
  } catch (error) {
    showBanner(`Scan failed: ${errorMessage(error)}`);
  } finally {
    setBusy(false);
  }
}

async function saveCatalog(): Promise<void> {
  const project = state.project;
  const locale = state.selected;
  if (!project || !locale || state.busy) return;
  let strings: unknown;
  try {
    strings = JSON.parse(els.editor.value);
  } catch (error) {
    els.editor.setAttribute('aria-invalid', 'true');
    setEditStatus(`Please check the JSON: ${(error as Error).message}`, 'error');
    els.editor.focus();
    return;
  }
  if (!strings || typeof strings !== 'object' || Array.isArray(strings)) {
    els.editor.setAttribute('aria-invalid', 'true');
    setEditStatus('The catalog must be a JSON object of strings.', 'error');
    return;
  }
  els.editor.removeAttribute('aria-invalid');
  setBusy(true);
  setEditStatus(`Saving ${locale}…`);
  try {
    const result = await api.saveCatalog(project.project.id, locale, strings as Record<string, unknown>);
    await loadProject(project.project.id);
    renderScan(result.issues, result.coverage, result.createdAt);
    fillEditor();
    setEditStatus(`${locale} saved and rescanned successfully.`, 'success');
  } catch (error) {
    setEditStatus(`Could not save ${locale}: ${errorMessage(error)}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function addLocale(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const project = state.project;
  if (!project || state.busy) return;
  const raw = els.newLocale.value.trim();
  let locale = '';
  try {
    locale = Intl.getCanonicalLocales(raw)[0] ?? '';
  } catch {
    locale = '';
  }
  const hint = (message: string): void => {
    els.newLocale.setAttribute('aria-invalid', 'true');
    els.newLocaleHint.textContent = message;
    els.newLocale.focus();
  };
  if (!raw || !locale) {
    hint('Enter a valid BCP 47 tag such as pt-BR.');
    return;
  }
  if (catalogFor(locale)) {
    hint(`${locale} already exists in this project.`);
    return;
  }
  setBusy(true);
  try {
    const result = await api.saveCatalog(project.project.id, locale, {});
    state.selected = locale;
    await loadProject(project.project.id);
    renderScan(result.issues, result.coverage, result.createdAt);
    fillEditor();
    els.dialog.close();
    setEditStatus(`${locale} added. Paste or type its translations below.`, 'success');
    els.editor.focus();
  } catch (error) {
    hint(errorMessage(error));
  } finally {
    setBusy(false);
  }
}

async function init(): Promise<void> {
  showBanner(null);
  setBusy(true, 'Loading…');
  try {
    const workspace = await api.workspace();
    const first = workspace.projects[0];
    if (!first) {
      els.projectName.textContent = 'No projects yet';
      els.projectDesc.textContent = 'Create one with POST /api/projects or enable SEED_DEMO.';
      els.updated.textContent = 'Nothing to sync';
      replaceChildren(els.localeList, [h('li', { class: 'placeholder-row' }, 'No catalogs.')]);
      replaceChildren(els.issues, [h('li', { class: 'placeholder-row' }, 'No scans yet.')]);
      els.findingCount.textContent = '0 results';
      return;
    }
    await loadProject(first.id);
    fillEditor();
    const latest = state.project?.latestScan;
    if (latest) {
      const scan = await api.scanDetail(first.id, latest.id);
      renderScan(scan.issues, scan.coverage, scan.createdAt);
    } else {
      setBusy(false);
      await runScan();
    }
  } catch (error) {
    els.sync.dataset.state = 'error';
    els.updated.textContent = 'Offline';
    els.scanStatus.dataset.state = 'error';
    els.scanStatus.textContent = '● UNAVAILABLE';
    replaceChildren(els.issues, [h('li', { class: 'placeholder-row' }, 'Findings are unavailable.')]);
    els.issues.setAttribute('aria-busy', 'false');
    els.findingCount.textContent = '—';
    showBanner(`Could not load workspace: ${errorMessage(error)}`);
  } finally {
    setBusy(false);
  }
}

/* ---------- wiring ---------- */

els.scan.addEventListener('click', () => void runScan());
els.save.addEventListener('click', () => void saveCatalog());
els.retry.addEventListener('click', () => void init());
els.localeSelect.addEventListener('change', () => selectLocale(els.localeSelect.value));
els.editor.addEventListener('input', () => {
  state.dirty = true;
});
els.editor.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void saveCatalog();
  }
});
els.addLocale.addEventListener('click', () => {
  els.newLocale.value = '';
  els.newLocale.removeAttribute('aria-invalid');
  els.newLocaleHint.textContent = 'BCP 47 tag such as fr-FR, pt-BR, he-IL or zh-Hant-TW.';
  els.dialog.showModal();
  els.newLocale.focus();
});
els.localeCancel.addEventListener('click', () => els.dialog.close());
els.localeForm.addEventListener('submit', (event) => void addLocale(event));
window.addEventListener('beforeunload', (event) => {
  if (state.dirty) event.preventDefault();
});

void init();
