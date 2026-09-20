import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../../services/workflow-api/src/app.js';
import { buildNotificationServer } from '../../services/notification-service/src/server.js';
import { buildAuditApp } from '../../services/audit-service/src/app.js';
import { pool as workflowPool } from '../../services/workflow-api/src/db/client.js';
import { pool as auditPool } from '../../services/audit-service/src/db/client.js';


describe('Deep Health & Readiness Probes Unit Tests', () => {
  describe('Workflow API Service Probes', () => {
    it('returns 200 for /health and /health/live with process uptime', async () => {
      const app = await buildApp();

      const resLive = await app.inject({
        method: 'GET',
        url: '/health/live',
      });

      expect(resLive.statusCode).toBe(200);
      const body = JSON.parse(resLive.body);
      expect(body.status).toBe('ok');
      expect(body.service).toBe('workflow-api');
      expect(typeof body.uptimeSeconds).toBe('number');
    });

    it('returns 200 for /health/ready when database is healthy', async () => {
      const querySpy = vi.spyOn(workflowPool, 'query').mockResolvedValueOnce({ rows: [{ '?column?': 1 }] } as any);
      const app = await buildApp();

      const resReady = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      expect(resReady.statusCode).toBe(200);
      const body = JSON.parse(resReady.body);
      expect(body.status).toBe('ready');
      expect(body.checks.database).toBe('ok');
      querySpy.mockRestore();
    });

    it('returns 503 for /health/ready when database connection fails', async () => {
      const querySpy = vi.spyOn(workflowPool, 'query').mockRejectedValueOnce(new Error('Connection timeout to Postgres'));
      const app = await buildApp();

      const resReady = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      expect(resReady.statusCode).toBe(503);
      const body = JSON.parse(resReady.body);
      expect(body.status).toBe('not_ready');
      expect(body.checks.database).toBe('error');
      expect(body.error).toContain('Connection timeout to Postgres');
      querySpy.mockRestore();
    });
  });

  describe('Notification Service Probes', () => {
    it('returns 200 for /health/live and /health/ready', async () => {
      const mockConsumer: any = { isConnected: true };
      const app = await buildNotificationServer(mockConsumer);

      const resLive = await app.inject({
        method: 'GET',
        url: '/health/live',
      });
      expect(resLive.statusCode).toBe(200);
      expect(JSON.parse(resLive.body).service).toBe('notification-service');

      const resReady = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });
      expect(resReady.statusCode).toBe(200);
      const readyBody = JSON.parse(resReady.body);
      expect(readyBody.status).toBe('ready');
      expect(readyBody.checks.kafkaConsumer).toBe('ok');
    });
  });

  describe('Audit Service Probes', () => {
    it('returns 200 for /health/live', async () => {
      const app = await buildAuditApp();

      const resLive = await app.inject({
        method: 'GET',
        url: '/health/live',
      });
      expect(resLive.statusCode).toBe(200);
      expect(JSON.parse(resLive.body).service).toBe('audit-service');
    });

    it('returns 200 for /health/ready when audit database is healthy', async () => {
      const querySpy = vi.spyOn(auditPool, 'query').mockResolvedValueOnce({ rows: [{ '?column?': 1 }] } as any);
      const app = await buildAuditApp();

      const resReady = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      expect(resReady.statusCode).toBe(200);
      const body = JSON.parse(resReady.body);
      expect(body.status).toBe('ready');
      expect(body.checks.database).toBe('ok');
      querySpy.mockRestore();
    });

    it('returns 503 for /health/ready when audit database is unreachable', async () => {
      const querySpy = vi.spyOn(auditPool, 'query').mockRejectedValueOnce(new Error('Audit DB socket closed'));
      const app = await buildAuditApp();

      const resReady = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      expect(resReady.statusCode).toBe(503);
      const body = JSON.parse(resReady.body);
      expect(body.status).toBe('not_ready');
      expect(body.checks.database).toBe('error');
      querySpy.mockRestore();
    });
  });

});
