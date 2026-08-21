export function uploadValidationError(file: File, maxFileSize: number) {
  return file.size > maxFileSize ? "This file is too large." : null;
}
