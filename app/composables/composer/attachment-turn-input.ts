export interface TurnFileCandidate {
  id?: string;
  name: string;
  path: string;
  mimeType?: string | null;
  size: number;
  isImage: boolean;
  dataUrl?: string;
}

export function remoteTurnFileInputs(files: TurnFileCandidate[]) {
  return files
    .filter((file) => !file.isImage)
    .map(({ name, path, mimeType, size, isImage }) => ({
      name,
      path,
      mimeType,
      size,
      isImage,
    }));
}
