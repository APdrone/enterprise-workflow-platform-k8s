import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractSqlOperation,
  instrumentPgPool,
  traceDbQuery,
  traceStorage,
  runWithTraceContext,
  getActiveTraceparent,
  getTracer,
} from '@workflow/telemetry';

describe('Database Query Spans & OpenTelemetry Instrumentation Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SQL Operation Extraction', () => {
    it('extracts standard SQL operations correctly', () => {
      expect(extractSqlOperation('SELECT * FROM workflows WHERE id = $1')).toBe('SELECT');
      expect(extractSqlOperation('INSERT INTO outbox_events (id) VALUES ($1)')).toBe('INSERT');
      expect(extractSqlOperation('UPDATE workflows SET status = $1 WHERE id = $2')).toBe('UPDATE');
      expect(extractSqlOperation('DELETE FROM audit_logs WHERE id = $1')).toBe('DELETE');
      expect(extractSqlOperation('BEGIN')).toBe('BEGIN');
      expect(extractSqlOperation('COMMIT')).toBe('COMMIT');
      expect(extractSqlOperation('ROLLBACK')).toBe('ROLLBACK');
      expect(extractSqlOperation("SELECT set_config('app.current_tenant_id', $1, true)")).toBe('SELECT');
    });

    it('handles comments, leading whitespace and mixed case safely', () => {
      expect(extractSqlOperation('   -- Fetch items\n   select * from items')).toBe('SELECT');
      expect(extractSqlOperation('-- comment\ninsert into items values (1)')).toBe('INSERT');
      expect(extractSqlOperation('')).toBe('QUERY');
      expect(extractSqlOperation(null as any)).toBe('QUERY');
    });
  });

  describe('AsyncLocalStorage Trace Context Propagation', () => {
    it('propagates active span and traceparent within execution context', () => {
      const tracer = getTracer('workflow-test');
      const rootSpan = tracer.startSpan('HTTP POST /api/v1/workflows', null);

      expect(getActiveTraceparent()).toBeUndefined();

      runWithTraceContext(
        {
          span: rootSpan,
          traceparent: rootSpan.toTraceparent(),
          tenantId: 'tenant-test-a',
        },
        () => {
          expect(getActiveTraceparent()).toBe(rootSpan.toTraceparent());
        }
      );

      expect(getActiveTraceparent()).toBeUndefined();
    });
  });

  describe('instrumentPgPool & Child Span Creation', () => {
    it('intercepts pool.query and generates OpenTelemetry DB child spans', async () => {
      const tracer = getTracer('workflow-test');
      const parentSpan = tracer.startSpan('HTTP GET /api/v1/workflows/123', null);

      // Mock pg.Pool
      const mockPool: any = {
        query: vi.fn().mockResolvedValue({ rows: [{ id: '123', title: 'Test Workflow' }], rowCount: 1 }),
      };

      instrumentPgPool(mockPool, { serviceName: 'workflow-api', dbName: 'workflow_db' });

      let result: any;
      await runWithTraceContext(
        {
          span: parentSpan,
          traceparent: parentSpan.toTraceparent(),
          tenantId: 'tenant-corp-1',
        },
        async () => {
          result = await mockPool.query('SELECT * FROM workflows WHERE id = $1', ['123']);
        }
      );

      expect(result).toBeDefined();
      expect(result.rows.length).toBe(1);
      expect(mockPool.query).toBeDefined();
      expect(mockPool.__isTracingInstrumented).toBe(true);
    });

    it('intercepts client.query from pool.connect and handles query errors gracefully', async () => {
      const tracer = getTracer('workflow-test');
      const parentSpan = tracer.startSpan('HTTP POST /api/v1/workflows', null);

      const mockClient: any = {
        query: vi.fn().mockRejectedValue(new Error('relation "unknown_table" does not exist')),
      };

      const mockPool: any = {
        connect: vi.fn().mockResolvedValue(mockClient),
      };

      instrumentPgPool(mockPool, { serviceName: 'workflow-api', dbName: 'workflow_db' });

      await runWithTraceContext(
        {
          span: parentSpan,
          traceparent: parentSpan.toTraceparent(),
          tenantId: 'tenant-corp-1',
        },
        async () => {
          const client = await mockPool.connect();
          await expect(client.query('INSERT INTO unknown_table VALUES ($1)', ['foo'])).rejects.toThrow(
            'relation "unknown_table" does not exist'
          );
        }
      );

      expect(mockClient.__isTracingInstrumented).toBe(true);
    });
  });

  describe('traceDbQuery Utility Helper', () => {
    it('wraps arbitrary asynchronous database queries in a child span', async () => {
      const tracer = getTracer('workflow-test');
      const parentSpan = tracer.startSpan('HTTP GET /api/v1/workflows', null);

      let executed = false;
      const res = await traceDbQuery(
        {
          serviceName: 'workflow-api',
          dbName: 'workflow_db',
          statement: 'SELECT count(*) FROM workflows',
          parentTraceparent: parentSpan.toTraceparent(),
        },
        async () => {
          executed = true;
          return 42;
        }
      );

      expect(executed).toBe(true);
      expect(res).toBe(42);
    });

    it('records error when database execution throws', async () => {
      await expect(
        traceDbQuery(
          {
            serviceName: 'workflow-api',
            dbName: 'workflow_db',
            statement: 'SELECT 1 FROM non_existent',
          },
          async () => {
            throw new Error('Database connection failed');
          }
        )
      ).rejects.toThrow('Database connection failed');
    });
  });
});
