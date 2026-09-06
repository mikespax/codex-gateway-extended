import "@open-file-viewer/core/style.css";
// Keep this as a Vite URL import instead of copying the worker into this package. Vite library
// mode either inlines assets or emits a package-relative URL that the consuming Nuxt build does
// not collect reliably. Externalizing this one import lets the final application build hash,
// publish, and rebase the worker together with its deployment base URL. That avoids a hardcoded
// public path/resource manifest while the app still imports only this package's semantic entry.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export { pdfWorkerUrl };

export {
  createViewer,
  fallbackPlugin,
  imagePlugin,
  officePlugin,
  pdfPlugin,
} from "@open-file-viewer/core";

export type {
  FileViewer,
  PreviewLocale,
  PreviewSource,
  PreviewTheme,
  PreviewToolbarOptions,
} from "@open-file-viewer/core";
