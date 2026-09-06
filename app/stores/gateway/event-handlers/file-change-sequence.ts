import { recordFromUnknown } from "~~/shared/utils/records";

let fileChangeSequence = 0;

export function tagFileChanges(changes: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(changes)) {
    return [];
  }
  return changes.flatMap((change) => {
    const record = recordFromUnknown(change);
    return record === null ? [] : [{ ...record, sequence: ++fileChangeSequence }];
  });
}
