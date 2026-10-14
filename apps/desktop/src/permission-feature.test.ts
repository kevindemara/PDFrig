import { describe, expect, it } from 'vitest';
import { permissionFeatureEnabled } from './permission-feature.js';

describe('SEC-003 desktop distribution gate', () => {
  it('defaults to development only and honors an explicit false', () => {
    expect(permissionFeatureEnabled(true, undefined)).toBe(true);
    expect(permissionFeatureEnabled(false, undefined)).toBe(false);
    expect(permissionFeatureEnabled(true, 'false')).toBe(false);
    expect(permissionFeatureEnabled(false, 'true')).toBe(true);
  });
  it.each(['yes', '', true, null, 1])('fails closed for malformed flag %s', (flag) => {
    expect(permissionFeatureEnabled(true, flag)).toBe(false);
    expect(permissionFeatureEnabled(false, flag)).toBe(false);
  });
});
