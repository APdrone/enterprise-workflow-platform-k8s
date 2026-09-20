import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from './AuthContext.js';

export interface SSEMessage {
  type: string;
  data: any;
  notification?: {
    id: string;
    type: string;
    title: string;
    body: string;
    workflowId?: string;
  };
  timestamp: string;
}

export interface ToastAlert {
  id: string;
  title: string;
  body: string;
  type: string;
}

interface SSEContextType {
  connected: boolean;
  lastEvent: SSEMessage | null;
  refreshSignal: number;
  unreadCount: number;
  incrementUnread: () => void;
  clearUnread: () => void;
  toast: ToastAlert | null;
  dismissToast: () => void;
}

const SSEContext = createContext<SSEContextType | undefined>(undefined);

export const SSEProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { tenantId, currentUser, notificationApiUrl } = useAuth();
  const [connected, setConnected] = useState<boolean>(false);
  const [lastEvent, setLastEvent] = useState<SSEMessage | null>(null);
  const [refreshSignal, setRefreshSignal] = useState<number>(0);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [toast, setToast] = useState<ToastAlert | null>(null);

  const incrementUnread = useCallback(() => {
    setUnreadCount((prev) => prev + 1);
  }, []);

  const clearUnread = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  // Fetch initial unread count
  useEffect(() => {
    async function loadNotifications() {
      try {
        const res = await fetch(`${notificationApiUrl}/api/v1/notifications?tenantId=${tenantId}&recipientId=${currentUser.id}`);
        if (res.ok) {
          const json = await res.json();
          if (json.data && Array.isArray(json.data)) {
            const unread = json.data.filter((n: any) => !n.read).length;
            setUnreadCount(unread);
          }
        }
      } catch {
        // notification service might be starting up
      }
    }
    loadNotifications();
  }, [tenantId, currentUser.id, notificationApiUrl]);

  // Connect to SSE stream
  useEffect(() => {
    const streamUrl = `${notificationApiUrl}/api/v1/stream?tenantId=${tenantId}&userId=${currentUser.id}`;
    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connect = () => {
      try {
        eventSource = new EventSource(streamUrl);

        eventSource.onopen = () => {
          setConnected(true);
          console.log(`[SSE] Connected to real-time stream (${streamUrl})`);
        };

        eventSource.onerror = () => {
          setConnected(false);
          eventSource?.close();
          // Auto-reconnect after 3s
          reconnectTimeout = setTimeout(connect, 3000);
        };

        // Listen to generic messages and workflow events
        const handleIncomingEvent = (event: MessageEvent) => {
          try {
            const payload: SSEMessage = JSON.parse(event.data);
            if (payload.type === 'CONNECTED') {
              setConnected(true);
              return;
            }

            setLastEvent(payload);
            setRefreshSignal((prev) => prev + 1);

            // Cross-MFE Event Bus: Notify embedded widgets of state change
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('workflow:state_changed', { detail: payload.data }));
            }

            // Trigger notification badge & toast alert
            if (payload.notification) {
              setUnreadCount((prev) => prev + 1);
              setToast({
                id: `toast-${Date.now()}`,
                title: payload.notification.title || 'Workflow Update',
                body: payload.notification.body || 'A workflow event occurred.',
                type: payload.type,
              });

              // Auto-dismiss toast after 6s
              setTimeout(() => {
                setToast((curr) => (curr?.id.startsWith('toast-') ? null : curr));
              }, 6000);
            }
          } catch (err) {
            console.warn('[SSE] Error parsing SSE payload:', err);
          }
        };

        // Standard message listener
        eventSource.onmessage = handleIncomingEvent;

        // Custom event listeners for all workflow CloudEvents
        const eventTypes = [
          'workflow.submitted.v1',
          'workflow.step_approved.v1',
          'workflow.approved.v1',
          'workflow.rejected.v1',
          'workflow.cancelled.v1',
        ];

        eventTypes.forEach((type) => {
          eventSource?.addEventListener(type, handleIncomingEvent as EventListener);
        });
      } catch (err) {
        console.warn('[SSE] Failed to initialize EventSource:', err);
        setConnected(false);
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSource) {
        eventSource.close();
      }
      setConnected(false);
    };
  }, [tenantId, currentUser.id, notificationApiUrl]);

  return (
    <SSEContext.Provider
      value={{
        connected,
        lastEvent,
        refreshSignal,
        unreadCount,
        incrementUnread,
        clearUnread,
        toast,
        dismissToast,
      }}
    >
      {children}
    </SSEContext.Provider>
  );
};

export function useSSE() {
  const context = useContext(SSEContext);
  if (!context) {
    throw new Error('useSSE must be used within an SSEProvider');
  }
  return context;
}
