import { AppError } from '@anumat/core';

export async function importStorageSdk<T>(specifier: string, kind: string): Promise<T> {
  try {
    return (await import(specifier)) as T;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    const message = error instanceof Error ? error.message : String(error);
    if (code === 'ERR_MODULE_NOT_FOUND' || /Cannot find module|Failed to resolve/.test(message)) {
      throw new AppError('storage_not_configured', `Install ${specifier} to use storage kind ${kind}.`, {
        specifier,
        kind,
      });
    }
    throw error;
  }
}
