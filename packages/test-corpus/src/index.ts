export interface FixtureManifestEntry {
  readonly expectedFeatures: readonly string[];
  readonly expectedPageCount: number;
  readonly expectedWarnings: readonly string[];
  readonly featureIds: readonly string[];
  readonly filename: string;
  readonly license: string;
  readonly origin: string;
  readonly sensitivity: 'none';
  readonly sha256: string;
}

export interface FixtureManifest {
  readonly fixtures: readonly FixtureManifestEntry[];
  readonly schemaVersion: 1;
}

export interface ImageFixtureManifestEntry {
  readonly encodedHeight: number;
  readonly encodedWidth: number;
  readonly expectedError?: 'UTILITY_IMAGE_ANIMATION_UNSUPPORTED';
  readonly expectedHeight: number;
  readonly expectedOrientation: number;
  readonly expectedWidth: number;
  readonly featureIds: readonly string[];
  readonly filename: string;
  readonly license: string;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly origin: string;
  readonly sensitivity: 'none';
  readonly sha256: string;
}

export interface ImageFixtureManifest {
  readonly fixtures: readonly ImageFixtureManifestEntry[];
  readonly schemaVersion: 1;
}
