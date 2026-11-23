export class UsageError extends Error {}

export class SourceError extends UsageError {}

export function inFile(file, work) {
  try {
    return work();
  } catch (error) {
    if (error instanceof SourceError) error.message = `${file}: ${error.message}`;
    throw error;
  }
}
