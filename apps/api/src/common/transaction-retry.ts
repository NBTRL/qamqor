/** Retry only PostgreSQL serialization/deadlock victims; the whole transaction was rolled back. */
export async function retryTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const database = error as { code?: string; meta?: { code?: string } } | null;
      const retryable =
        database?.code === 'P2034' ||
        (database?.code === 'P2010' && ['40P01', '40001'].includes(database.meta?.code ?? ''));
      if (!retryable || attempt >= 2) throw error;
      // Let the winning transaction release its locks before retrying the victim.
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
