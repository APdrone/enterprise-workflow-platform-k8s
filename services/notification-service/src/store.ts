import { NotificationRecord } from '@workflow/shared-types';

export class NotificationStore {
  private notifications: NotificationRecord[] = [];
  private processedEventIds = new Set<string>();

  hasProcessedEvent(eventId: string): boolean {
    return this.processedEventIds.has(eventId);
  }

  markEventProcessed(eventId: string): void {
    this.processedEventIds.add(eventId);
  }

  addNotification(notification: NotificationRecord): void {
    this.notifications.unshift(notification);
    // Keep last 500
    if (this.notifications.length > 500) {
      this.notifications.pop();
    }
  }

  getNotifications(tenantId?: string, recipientId?: string): NotificationRecord[] {
    return this.notifications.filter((n) => {
      if (tenantId && n.tenantId !== tenantId) return false;
      if (recipientId && n.recipientId !== recipientId) return false;
      return true;
    });
  }

  clear(): void {
    this.notifications = [];
    this.processedEventIds.clear();
  }
}

export const notificationStore = new NotificationStore();
