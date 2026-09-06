export type { HighlightLanguage } from "./index";

export function isHighlightLanguage(_language: string): _language is never {
  return false;
}

export async function highlightCode(_value: string, _language: string): Promise<undefined> {
  return undefined;
}
