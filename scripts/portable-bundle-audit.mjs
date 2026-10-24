// Optional native Canvas remains a declared-input notice gap. A browser-only
// artifact may proceed only with positive module-graph and payload absence checks.
import { writeFileSync } from 'node:fs';
export function assertPortableModules(ids) {
  const modules = [...ids].map((id) => id.replaceAll('\\', '/'));
  if (modules.some((id) => /@napi-rs(?:\+|\/)canvas|\.node(?:$|\?)/iu.test(id)))
    throw new Error('PORTABLE_NATIVE_CANVAS_INCLUDED');
  return {
    schemaVersion: 1,
    nativeCanvasIncluded: false,
    modules: modules.map((id) =>
      id.includes('/node_modules/')
        ? id.slice(id.lastIndexOf('/node_modules/') + 14)
        : id.startsWith('\0')
          ? id.slice(1)
          : id.split('/').slice(-3).join('/'),
    ),
  };
}
export function portableBundleAudit(output) {
  return {
    name: 'pdfrig-portable-payload-audit',
    generateBundle() {
      writeFileSync(
        output,
        JSON.stringify(assertPortableModules(this.getModuleIds()), null, 2) + '\n',
      );
    },
  };
}
