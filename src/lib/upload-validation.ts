function formatMaxFileSize(maxFileSize: number) {
  if (maxFileSize >= 1024 ** 3) {
    const gb = maxFileSize / 1024 ** 3;
    return `${Number.isInteger(gb) ? gb : Math.round(gb * 10) / 10} GB`;
  }
  if (maxFileSize >= 1024 ** 2) return `${Math.round(maxFileSize / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.ceil(maxFileSize / 1024))} KB`;
}

export function maxFileSizeMessage(maxFileSize: number) {
  return `Maximum file size is ${formatMaxFileSize(maxFileSize)}.`;
}

export function uploadValidationError(file: File, maxFileSize: number) {
  if (file.size === 0) return "Empty files can’t be uploaded.";
  return file.size > maxFileSize ? maxFileSizeMessage(maxFileSize) : null;
}

export function uploadBatchValidationError(files: File[], maxFileSize: number) {
  for (const file of files) {
    const error = uploadValidationError(file, maxFileSize);
    if (error) return error;
  }
  return null;
}
