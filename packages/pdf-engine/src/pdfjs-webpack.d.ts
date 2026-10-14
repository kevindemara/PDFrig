declare module 'pdfjs-dist/webpack.mjs' {
  export * from 'pdfjs-dist';
}

declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
