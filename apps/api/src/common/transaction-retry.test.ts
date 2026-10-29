import { describe, expect, it, vi } from 'vitest';
import { retryTransaction } from './transaction-retry.js';

describe('Transaction retry', () => {
  it.each([
    { code: 'P2034' },
    { code: 'P2010', meta: { code: '40P01' } },
    { code: 'P2010', meta: { code: '40001' } },
    { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '40P01' } } } },
    { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '40001' } } } },
    { code: 'P2010', meta: { driverAdapterError: { cause: { code: '40P01' } } } },
    { code: 'P2039', meta: { driverAdapterError: { cause: { code: '40P01' } } } },
  ])('retries a rolled-back transaction (%j)', async (error) => {
    const operation = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('committed');
    await expect(retryTransaction(operation)).resolves.toBe('committed');
    expect(operation).toHaveBeenCalledTimes(2);
  });
  it('bounds retries and retains the database error', async () => {
    const error = { code: 'P2034' };
    const operation = vi.fn().mockRejectedValue(error);
    await expect(retryTransaction(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(3);
  });
  it.each([
    new Error('notification persistence failed'),
    { code: 'P2010', meta: { driverAdapterError: { cause: { code: '23505' } } } },
    { code: 'VALIDATION_ERROR', meta: { code: '40P01' } },
  ])('does not retry validation or other persistence failures (%j)', async (error) => {
    const operation = vi.fn().mockRejectedValue(error);
    await expect(retryTransaction(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
