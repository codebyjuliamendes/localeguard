/** Input bounds shared by request validation and services. */
export const LIMITS = {
  nameMin: 2,
  nameMax: 80,
  catalogsPerProject: 20,
  stringLength: 2000,
  keyLength: 200,
  keysPerCatalog: 5000,
  budgetMax: 10_000,
} as const;
