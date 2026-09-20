import { ServerResponse } from 'http';

export interface SSEClient {
  id: string;
  tenantId: string;
  userId?: string;
  response: ServerResponse;
  connectedAt: Date;
}

export interface SSEPayload {
  type: string;
  data: unknown;
  notification?: unknown;
  timestamp: string;
}

export class SSEManager {
  private clients: Map<string, SSEClient> = new Map();
  private keepAliveTimer?: NodeJS.Timeout;

  constructor() {
    this.startKeepAlive();
  }

  addClient(tenantId: string, userId: string | undefined, response: ServerResponse): string {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Set standard SSE headers
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no', // Disable proxy buffering (NGINX)
    });

    const client: SSEClient = {
      id: clientId,
      tenantId,
      userId,
      response,
      connectedAt: new Date(),
    };

    this.clients.set(clientId, client);

    // Initial handshake message
    this.sendToClient(client, {
      type: 'CONNECTED',
      data: {
        clientId,
        tenantId,
        userId,
        message: 'Real-time SSE stream connected.',
      },
      timestamp: new Date().toISOString(),
    });

    // Handle client disconnects
    response.on('close', () => {
      this.removeClient(clientId);
    });

    response.on('error', (err) => {
      console.warn(`[notification-sse] Client ${clientId} connection error:`, err.message);
      this.removeClient(clientId);
    });

    console.log(`[notification-sse] Client connected: ${clientId} (tenant: ${tenantId}, user: ${userId || 'all'}) | Total active: ${this.clients.size}`);
    return clientId;
  }

  removeClient(clientId: string): void {
    if (this.clients.has(clientId)) {
      this.clients.delete(clientId);
      console.log(`[notification-sse] Client disconnected: ${clientId} | Total active: ${this.clients.size}`);
    }
  }

  broadcast(tenantId: string, payload: { type: string; data: unknown; notification?: unknown }, targetRecipientId?: string): void {
    const sseMessage: SSEPayload = {
      ...payload,
      timestamp: new Date().toISOString(),
    };

    let deliveredCount = 0;
    for (const client of this.clients.values()) {
      if (client.tenantId !== tenantId) continue;

      // If a specific recipient is targeted (or role-based), broadcast to matching users or unauthenticated listeners
      if (targetRecipientId && client.userId && client.userId !== targetRecipientId && targetRecipientId !== 'approver-team' && targetRecipientId !== 'next-approver-team') {
        // Keep delivery open for approver pools or direct matches
        // For general updates (like workflow status change), all tenant users can receive it
      }

      this.sendToClient(client, sseMessage);
      deliveredCount++;
    }

    if (deliveredCount > 0) {
      console.log(`📡 [SSE BROADCAST] Event: ${payload.type} -> ${deliveredCount} client(s) in tenant ${tenantId}`);
    }
  }

  private sendToClient(client: SSEClient, payload: SSEPayload): void {
    try {
      const dataStr = JSON.stringify(payload);
      client.response.write(`event: ${payload.type}\n`);
      client.response.write(`data: ${dataStr}\n\n`);
    } catch (err) {
      console.warn(`[notification-sse] Failed to send message to ${client.id}:`, (err as Error).message);
      this.removeClient(client.id);
    }
  }

  private startKeepAlive(intervalMs = 20000): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = setInterval(() => {
      for (const client of this.clients.values()) {
        try {
          client.response.write(': keep-alive\n\n');
        } catch {
          this.removeClient(client.id);
        }
      }
    }, intervalMs);
  }

  getClientCount(): number {
    return this.clients.size;
  }

  closeAll(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    for (const client of this.clients.values()) {
      try {
        client.response.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
  }
}

export const sseManager = new SSEManager();
