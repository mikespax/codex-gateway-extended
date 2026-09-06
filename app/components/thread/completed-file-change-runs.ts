import type { ThreadTimelineItem } from "~~/shared/types";

export function compactCompletedFileChangeRuns(items: ThreadTimelineItem[]) {
  const compacted: ThreadTimelineItem[] = [];
  let index = 0;

  while (index < items.length) {
    const item = items[index]!;
    if (!isCompactableFileChange(item)) {
      compacted.push(item);
      index += 1;
      continue;
    }

    const run = [item];
    let nextIndex = index + 1;
    while (nextIndex < items.length && isCompactableFileChange(items[nextIndex]!)) {
      run.push(items[nextIndex]!);
      nextIndex += 1;
    }

    compacted.push(run.length === 1 ? item : aggregateFileChangeRun(run, index));
    index = nextIndex;
  }

  return compacted;
}

function isCompactableFileChange(item: ThreadTimelineItem) {
  return (
    item.type === "fileChange" &&
    statusValue(item.status) === "completed" &&
    item.pendingApproval == null
  );
}

function aggregateFileChangeRun(run: ThreadTimelineItem[], index: number): ThreadTimelineItem {
  const first = run[0]!;
  return {
    ...first,
    id: `completed-file-change-run-${index}-${run.length}`,
    changes: run.flatMap((item) => (Array.isArray(item.changes) ? item.changes : [])),
    aggregatedOutput: "",
    aggregatedStepCount: run.length,
  };
}

function statusValue(status: unknown) {
  if (typeof status === "string") return status;
  if (typeof status !== "object" || status === null || Array.isArray(status)) return undefined;
  for (const [key, value] of Object.entries(status)) {
    if (key === "type") return typeof value === "string" ? value : undefined;
  }
  return undefined;
}
