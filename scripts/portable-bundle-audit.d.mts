/** Structural build-hook types keep the Node-only helper independent of Vite. */
export declare function assertPortableModules(ids: Iterable<string>): {
  schemaVersion: number;
  nativeCanvasIncluded: false;
  modules: string[];
};
export declare function portableBundleAudit(output: string): {
  name: string;
  generateBundle(this: { getModuleIds(): IterableIterator<string> }): void;
};
