abstract class RemotePathRequestError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class RemoteDirectoryNotFoundError extends RemotePathRequestError {
  readonly statusCode = 404;
  readonly code = "remoteDirectoryNotFound";

  constructor(
    readonly inputPath: string,
    readonly resolvedPath: string,
    options?: ErrorOptions,
  ) {
    super(
      `Remote directory does not exist or is not a directory: ${inputPath} (resolved to ${resolvedPath})`,
      options,
    );
  }
}

export class RemoteDirectoryAccessDeniedError extends RemotePathRequestError {
  readonly statusCode = 403;
  readonly code = "remoteDirectoryAccessDenied";

  constructor(
    readonly inputPath: string,
    readonly resolvedPath: string,
    options?: ErrorOptions,
  ) {
    super(
      `Permission denied while reading remote directory: ${inputPath} (resolved to ${resolvedPath})`,
      options,
    );
  }
}

export class RemoteFileInvalidPathError extends RemotePathRequestError {
  readonly statusCode = 400;
  readonly code = "invalidRemoteFilePath";

  constructor(path: string) {
    super(`Remote file path must be absolute: ${path}`);
  }
}

export class RemoteFileNotFoundError extends RemotePathRequestError {
  readonly statusCode = 404;
  readonly code = "remoteFileNotFound";

  constructor(path: string, options?: ErrorOptions) {
    super(`Remote file not found: ${path}`, options);
  }
}

export class RemoteFileAccessDeniedError extends RemotePathRequestError {
  readonly statusCode = 403;
  readonly code = "remoteFileAccessDenied";

  constructor(path: string, options?: ErrorOptions) {
    super(`Permission denied while reading remote file: ${path}`, options);
  }
}

export class RemoteFileTooLargeError extends RemotePathRequestError {
  readonly statusCode = 413;
  readonly code = "remoteFileTooLarge";

  constructor(path: string, maxSize: number) {
    super(`Remote file exceeds ${maxSize} bytes: ${path}`);
  }
}

export class RemoteFileNotRegularError extends RemotePathRequestError {
  readonly statusCode = 422;
  readonly code = "remotePathNotFile";

  constructor(path: string) {
    super(`Remote path is not a regular file: ${path}`);
  }
}

/** Unknown SSH, channel and proxy failures deliberately pass through and remain HTTP 502. */
export function classifyRemoteFileError(error: unknown, path: string) {
  if (error instanceof RemotePathRequestError) return error;
  if (isMissingSftpPath(error)) {
    return new RemoteFileNotFoundError(path, { cause: error });
  }
  if (isDeniedSftpPath(error)) {
    return new RemoteFileAccessDeniedError(path, { cause: error });
  }
  return standardError(error, `Unable to read remote file: ${path}`);
}

export function classifyRemoteDirectoryError(
  error: unknown,
  inputPath: string,
  resolvedPath: string,
) {
  if (isMissingSftpPath(error)) {
    return new RemoteDirectoryNotFoundError(inputPath, resolvedPath, { cause: error });
  }
  if (isDeniedSftpPath(error)) {
    return new RemoteDirectoryAccessDeniedError(inputPath, resolvedPath, { cause: error });
  }
  return standardError(error, `Unable to read remote directory: ${inputPath}`);
}

export function isMissingSftpPath(error: unknown) {
  const code = recordFromUnknown(error)?.code;
  return (
    code === 2 ||
    code === "ENOENT" ||
    code === "remoteFileNotFound" ||
    code === "remoteDirectoryNotFound"
  );
}

function isDeniedSftpPath(error: unknown) {
  const code = recordFromUnknown(error)?.code;
  return code === 3 || code === "EACCES" || code === "EPERM";
}

function standardError(error: unknown, message: string) {
  return error instanceof Error ? error : new Error(message, { cause: error });
}
import { recordFromUnknown } from "~~/shared/utils/records";
