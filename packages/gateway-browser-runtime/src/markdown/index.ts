import { katex } from "@mdit/plugin-katex";
import "katex/dist/katex.min.css";
import MarkdownIt from "markdown-it";

export interface MarkdownCodeFence {
  content: string;
  language: string;
}

export type MarkdownCodeFenceRenderer = (fence: MarkdownCodeFence) => Promise<string | undefined>;

export interface MarkdownRenderer {
  hasCodeFences(content: string): boolean;
  render(content: string): string;
  renderEnhanced(content: string, renderFence: MarkdownCodeFenceRenderer): Promise<string>;
}

export function createMarkdownRenderer(): MarkdownRenderer {
  const highlightedFences = new WeakMap<object, string>();
  const markdown = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: false,
  });

  // Markdown is rendered into the live Gateway document with `v-html`. Keep
  // ordinary links from navigating the current chat away: opening a new
  // browsing context preserves the active thread, composer state, and any
  // in-progress work in the original tab. `noopener` also prevents the new
  // page from gaining a reference to the Gateway window.
  markdown.renderer.rules.link_open = (tokens, index, options, environment, self) => {
    const token = tokens[index];
    if (token !== undefined) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
    }
    return self.renderToken(tokens, index, options);
  };

  markdown.use(katex, {
    delimiters: "all",
    throwOnError: false,
    strict: false,
    trust: false,
  });

  const defaultFenceRenderer = markdown.renderer.rules.fence;
  markdown.renderer.rules.fence = (tokens, index, options, environment, self) => {
    const token = tokens[index];
    const highlightedHtml = token === undefined ? undefined : highlightedFences.get(token);
    if (highlightedHtml !== undefined) {
      return highlightedHtml;
    }
    return defaultFenceRenderer === undefined
      ? self.renderToken(tokens, index, options)
      : defaultFenceRenderer(tokens, index, options, environment, self);
  };

  function parse(content: string) {
    return markdown.parse(content, {});
  }

  function renderTokens(tokens: ReturnType<typeof parse>) {
    return markdown.renderer.render(tokens, markdown.options, {});
  }

  return {
    hasCodeFences(content) {
      return parse(content).some((token) => token.type === "fence");
    },
    render(content) {
      return renderTokens(parse(content));
    },
    async renderEnhanced(content, renderFence) {
      const tokens = parse(content);
      for (const token of tokens) {
        if (token.type !== "fence") {
          continue;
        }
        const highlightedHtml = await renderFence({
          content: token.content,
          language: token.info,
        });
        if (highlightedHtml !== undefined) {
          highlightedFences.set(token, highlightedHtml);
        }
      }
      return renderTokens(tokens);
    },
  };
}
