import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SSEManager } from '../../services/notification-service/src/sse.js';
import { EventEmitter } from 'events';

class MockServerResponse extends EventEmitter {
  public headers: Record<string, any> = {};
  public statusCode: number = 200;
  public writtenData: string[] = [];
  public ended: boolean = false;

  writeHead(statusCode: number, headers: Record<string, any>) {
    this.statusCode = statusCode;
    this.headers = headers;
    return this;
  }

  write(chunk: string) {
    this.writtenData.push(chunk);
    return true;
  }

  end() {
    this.ended = true;
    this.emit('close');
    return this;
  }
}

describe('SSEManager (Real-Time Live Sync)', () => {
  let sseManager: SSEManager;

  beforeEach(() => {
    sseManager = new SSEManager();
  });

  afterEach(() => {
    sseManager.closeAll();
  });

  it('registers a client connection and sends initial handshake', () => {
    const mockRes = new MockServerResponse() as any;
    const clientId = sseManager.addClient('tenant-corp-a', 'user-alice', mockRes);

    expect(clientId).toBeDefined();
    expect(sseManager.getClientCount()).toBe(1);
    expect(mockRes.statusCode).toBe(200);
    expect(mockRes.headers['Content-Type']).toBe('text/event-stream');

    // Verify initial handshake message
    expect(mockRes.writtenData.length).toBeGreaterThan(0);
    expect(mockRes.writtenData[0]).toContain('event: CONNECTED');
  });

  it('broadcasts event to clients belonging to the target tenant', () => {
    const resA = new MockServerResponse() as any;
    const resB = new MockServerResponse() as any;

    sseManager.addClient('tenant-corp-a', 'user-alice', resA);
    sseManager.addClient('tenant-corp-b', 'user-bob', resB);

    sseManager.broadcast('tenant-corp-a', {
      type: 'workflow.approved.v1',
      data: { workflowId: 'wf-100', status: 'APPROVED' },
    });

    // Client in tenant-corp-a receives event
    const receivedA = resA.writtenData.find((d: string) => d.includes('workflow.approved.v1'));
    expect(receivedA).toBeDefined();

    // Client in tenant-corp-b does NOT receive tenant-corp-a event
    const receivedB = resB.writtenData.find((d: string) => d.includes('workflow.approved.v1'));
    expect(receivedB).toBeUndefined();
  });

  it('removes client upon connection close', () => {
    const mockRes = new MockServerResponse() as any;
    sseManager.addClient('tenant-corp-a', 'user-alice', mockRes);
    expect(sseManager.getClientCount()).toBe(1);

    mockRes.emit('close');
    expect(sseManager.getClientCount()).toBe(0);
  });
});
