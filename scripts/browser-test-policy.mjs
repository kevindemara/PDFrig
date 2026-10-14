// Existing launch-core verification: retries collect evidence, never grant CI success.
export const browserTestPolicy = (ci = process.env.CI) => ({
  failOnFlakyTests: Boolean(ci),
  retries: ci ? 2 : 0,
});
