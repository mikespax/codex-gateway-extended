import { bundledLanguages, codeToHtml } from "./generated";

export type HighlightLanguage = keyof typeof bundledLanguages;

const themes = {
  light: "github-light-default",
  dark: "github-dark-default",
} as const;

export function isHighlightLanguage(language: string): language is HighlightLanguage {
  return Object.hasOwn(bundledLanguages, language);
}

export async function highlightCode(value: string, language: string): Promise<string | undefined> {
  if (!isHighlightLanguage(language)) {
    return undefined;
  }
  return await codeToHtml(value, {
    lang: language,
    themes,
    defaultColor: false,
    structure: "inline",
  });
}
