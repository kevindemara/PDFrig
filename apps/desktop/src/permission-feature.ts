/** SEC-003 is opt-in in distributions; an explicit false also disables development. */
export const permissionFeatureEnabled = (development: boolean, flag: unknown): boolean =>
  flag === undefined ? development : flag === 'true';
