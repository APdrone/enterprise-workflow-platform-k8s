import { vi } from 'vitest';

/**
 * Creates a fully chainable mock Drizzle database instance for unit tests.
 */
export function createMockDb(options: { selectResult?: any[]; returningResult?: any[] } = {}) {
  const createChain = (result: any = options.selectResult ?? []) => {
    const chain: any = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      offset: vi.fn(),
      values: vi.fn(),
      set: vi.fn(),
      returning: vi.fn().mockResolvedValue(options.returningResult ?? result),
      then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(result).catch(reject),
    };

    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.offset.mockReturnValue(chain);
    chain.values.mockReturnValue(chain);
    chain.set.mockReturnValue(chain);

    return chain;
  };

  const defaultChain = createChain();

  const mockDb = {
    select: vi.fn(() => createChain()),
    insert: vi.fn(() => createChain()),
    update: vi.fn(() => createChain()),
    delete: vi.fn(() => createChain()),
    transaction: vi.fn(async (callback: any) => callback(mockDb)),
    _defaultChain: defaultChain,
  };

  return mockDb;
}
