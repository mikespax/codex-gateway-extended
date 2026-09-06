import { Chunk, unifiedMergeView } from "@codemirror/merge";
import { RangeSetBuilder, StateField, Text, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";

const diffConfig = { scanLimit: 500, timeout: 500 } as const;

class GitChangeMarker extends GutterMarker {
  constructor(readonly kind: "added" | "modified" | "deleted") {
    super();
  }

  override eq(other: GitChangeMarker) {
    return this.kind === other.kind;
  }

  override toDOM() {
    const marker = document.createElement("span");
    marker.className = `cm-gitChangeMarker cm-gitChangeMarker-${this.kind}`;
    return marker;
  }
}

const markers = {
  added: new GitChangeMarker("added"),
  modified: new GitChangeMarker("modified"),
  deleted: new GitChangeMarker("deleted"),
} as const;

export function gitQuickDiffExtension(original: string): Extension {
  const originalDocument = Text.of(original.split("\n"));
  const chunks = StateField.define<readonly Chunk[]>({
    create: (state) => Chunk.build(originalDocument, state.doc, diffConfig),
    update: (value, transaction) =>
      transaction.docChanged
        ? Chunk.updateB(
            value,
            originalDocument,
            transaction.state.doc,
            transaction.changes,
            diffConfig,
          )
        : value,
  });
  return [
    chunks,
    gutter({
      class: "cm-gitChangeGutter",
      markers(view) {
        const builder = new RangeSetBuilder<GutterMarker>();
        const document = view.state.doc;
        for (const chunk of view.state.field(chunks)) {
          if (chunk.fromB === chunk.toB) {
            const position = Math.min(chunk.fromB, document.length);
            builder.add(
              document.lineAt(position).from,
              document.lineAt(position).from,
              markers.deleted,
            );
            continue;
          }
          const marker = chunk.fromA === chunk.toA ? markers.added : markers.modified;
          let line = document.lineAt(Math.min(chunk.fromB, document.length));
          const end = Math.min(chunk.endB, document.length);
          while (true) {
            builder.add(line.from, line.from, marker);
            if (line.to >= end || line.number >= document.lines) break;
            line = document.line(line.number + 1);
          }
        }
        return builder.finish();
      },
    }),
    gitDiffTheme,
  ];
}

export function gitUnifiedDiffExtension(original: string): Extension {
  return [
    unifiedMergeView({
      original,
      gutter: true,
      highlightChanges: true,
      allowInlineDiffs: true,
      mergeControls: false,
      collapseUnchanged: { margin: 3, minSize: 8 },
      diffConfig,
    }),
    gitDiffTheme,
  ];
}

const gitDiffTheme = EditorView.baseTheme({
  ".cm-gitChangeGutter": { width: "0.25rem" },
  ".cm-gitChangeMarker": {
    display: "block",
    width: "0.2rem",
    height: "100%",
    minHeight: "1.5rem",
  },
  ".cm-gitChangeMarker-added": { backgroundColor: "var(--accent-green)" },
  ".cm-gitChangeMarker-modified": { backgroundColor: "var(--primary)" },
  ".cm-gitChangeMarker-deleted": { backgroundColor: "var(--destructive)" },
  ".cm-deletedChunk": {
    backgroundColor: "color-mix(in srgb, var(--destructive) 10%, transparent)",
  },
  ".cm-insertedLine": {
    backgroundColor: "color-mix(in srgb, var(--accent-green) 10%, transparent)",
  },
});
