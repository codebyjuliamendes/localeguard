import { z } from 'zod';
import { flattenCatalog, MAX_DEPTH } from '../domain/catalog.js';
import { isValidLocale } from '../domain/locale.js';
import type { CatalogTree } from '../domain/types.js';
import { LIMITS } from '../limits.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export const LocaleSchema = z.string().trim().refine(isValidLocale, { message: 'Use a BCP 47 locale such as en-US, pt-BR or zh-Hant-TW.' });

const KeySchema = z
  .string()
  .min(1, 'Keys cannot be empty.')
  .max(LIMITS.keyLength, `Keys are limited to ${LIMITS.keyLength} characters.`)
  .refine((key) => !FORBIDDEN_KEYS.has(key), { message: 'Reserved key name.' });

const TreeSchema: z.ZodType<CatalogTree> = z.lazy(() =>
  z.record(
    KeySchema,
    z.union([z.string().max(LIMITS.stringLength, `Strings are limited to ${LIMITS.stringLength} characters.`), TreeSchema]),
  ),
);

/** Nested or flat catalog of strings, bounded in depth and size. */
export const CatalogSchema = TreeSchema.superRefine((tree, ctx) => {
  const flat = flattenCatalog(tree);
  if (flat.invalid.length) ctx.addIssue({ code: 'custom', message: `Catalogs can be nested at most ${MAX_DEPTH} levels deep.` });
  if (flat.entries.size > LIMITS.keysPerCatalog)
    ctx.addIssue({ code: 'custom', message: `Catalogs are limited to ${LIMITS.keysPerCatalog} keys.` });
});

export const BudgetsSchema = z
  .record(KeySchema, z.number().int().positive().max(LIMITS.budgetMax))
  .refine((budgets) => Object.keys(budgets).length <= LIMITS.keysPerCatalog, { message: 'Too many budgets.' });

export const ProjectParamsSchema = z.object({ id: z.coerce.number().int().positive() });
export const ScanParamsSchema = ProjectParamsSchema.extend({ scanId: z.coerce.number().int().positive() });
export const CatalogParamsSchema = ProjectParamsSchema.extend({ locale: LocaleSchema });

export const CreateProjectSchema = z
  .object({
    name: z.string().trim().min(LIMITS.nameMin).max(LIMITS.nameMax),
    baseLocale: LocaleSchema,
    catalogs: z.record(LocaleSchema, CatalogSchema),
    budgets: BudgetsSchema.optional(),
  })
  .superRefine((body, ctx) => {
    const count = Object.keys(body.catalogs).length;
    if (count > LIMITS.catalogsPerProject)
      ctx.addIssue({ code: 'custom', path: ['catalogs'], message: `At most ${LIMITS.catalogsPerProject} catalogs.` });
    if (!(body.baseLocale in body.catalogs))
      ctx.addIssue({ code: 'custom', path: ['catalogs'], message: 'The base locale catalog is required.' });
  });

export const UpdateCatalogSchema = z.object({
  strings: CatalogSchema,
  direction: z.enum(['ltr', 'rtl']).optional(),
});

export const UpdateBudgetsSchema = z.object({ budgets: BudgetsSchema });
