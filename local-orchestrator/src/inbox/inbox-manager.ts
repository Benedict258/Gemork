import { EventEmitter } from "events";
import {
  createInboxItem,
  compareInboxPriority,
  type InboxItem,
  type InboxItemType,
  type InboxPayload,
} from "./inbox-item.js";
import { InboxStore, type InboxStats } from "./inbox-store.js";

export type InboxEvent =
  | { type: "item:added"; item: InboxItem }
  | { type: "item:resolved"; item: InboxItem; response?: unknown }
  | { type: "item:cancelled"; item: InboxItem };

export type InboxEventHandler = (event: InboxEvent) => void;

export class InboxManager extends EventEmitter {
  private store: InboxStore;
  private currentItem: InboxItem | null = null;
  private processing = false;

  constructor(projectId: string, baseDir?: string) {
    super();
    this.store = new InboxStore(projectId, baseDir);
    this.rehydrateCurrentItem();
  }

  enqueue(
    itemData: Omit<InboxItem, "id" | "status" | "createdAt">,
  ): string {
    const item = createInboxItem(itemData.type, itemData.payload);
    this.store.addItem(item);
    this.emitEvent({ type: "item:added", item });

    if (!this.currentItem && !this.processing) {
      this.advance();
    }

    return item.id;
  }

  next(): InboxItem | null {
    const pending = this.store.getPendingItems();
    if (pending.length === 0) return null;

    pending.sort(compareInboxPriority);
    return pending[0];
  }

  resolve(id: string, response?: unknown): void {
    const item = this.store.getItem(id);
    if (!item) throw new Error(`Inbox item ${id} not found`);
    if (item.status !== "pending") {
      throw new Error(`Inbox item ${id} is already ${item.status}`);
    }

    this.store.resolveItem(id, response);

    if (this.currentItem?.id === id) {
      this.currentItem = null;
    }

    this.emitEvent({ type: "item:resolved", item, response });
    this.advance();
  }

  cancel(id: string): void {
    const item = this.store.getItem(id);
    if (!item) throw new Error(`Inbox item ${id} not found`);
    if (item.status !== "pending") {
      throw new Error(`Inbox item ${id} is already ${item.status}`);
    }

    this.store.cancelItem(id);

    if (this.currentItem?.id === id) {
      this.currentItem = null;
    }

    this.emitEvent({ type: "item:cancelled", item });
    this.advance();
  }

  getCurrentItem(): InboxItem | null {
    return this.currentItem;
  }

  getPendingCount(): number {
    return this.store.getPendingItems().length;
  }

  getStats(): InboxStats {
    return this.store.getStats();
  }

  onItemAdded(callback: InboxEventHandler): () => void {
    this.on("item:added", callback);
    return () => this.off("item:added", callback);
  }

  onItemResolved(callback: InboxEventHandler): () => void {
    this.on("item:resolved", callback);
    return () => this.off("item:resolved", callback);
  }

  private advance(): void {
    if (this.processing) return;
    this.processing = true;

    try {
      if (!this.currentItem) {
        const next = this.next();
        if (next) {
          this.currentItem = next;
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private emitEvent(event: InboxEvent): void {
    this.emit(event.type, event);
  }

  private rehydrateCurrentItem(): void {
    const pending = this.store.getPendingItems();
    if (pending.length > 0) {
      pending.sort(compareInboxPriority);
      this.currentItem = pending[0];
    }
  }
}
