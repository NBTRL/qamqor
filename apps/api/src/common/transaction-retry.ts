/** Retry only PostgreSQL serialization/deadlock victims; the whole transaction was rolled back. */
export async function retryTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const database = error as {
        code?: string;
        meta?: {
          code?: string;
          driverAdapterError?: { cause?: { originalCode?: string; code?: string } };
        };
      } | null;
      const sqlState =
        database?.meta?.code ??
        database?.meta?.driverAdapterError?.cause?.originalCode ??
        database?.meta?.driverAdapterError?.cause?.code;
      const retryable =
        database?.code === 'P2034' ||
        (['P2010', 'P2039'].includes(database?.code ?? '') &&
          ['40P01', '40001'].includes(sqlState ?? ''));
      if (!retryable || attempt >= 2) throw error;
      // Let the winning transaction release its locks before retrying the victim.
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
