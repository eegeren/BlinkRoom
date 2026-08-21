export function uploadValidationError(file: File, maxFileSize: number) {
  if (file.size === 0) return "Empty files can’t be uploaded.";
  return file.size > maxFileSize ? "This file is too large." : null;
}

export function uploadBatchValidationError(files: File[], maxFileSize: number) {
  for (const file of files) {
    const error = uploadValidationError(file, maxFileSize);
    if (error) return error;
  }
  return null;
}
