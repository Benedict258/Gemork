import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import type { InboxItem } from "./inbox-item.js";

export interface InboxStats {
  pending: number;
  resolved: number;
  cancelled: number;
}

export class InboxStore {
  private filePath: string;
  private items: InboxItem[] = [];

  constructor(projectId: string, baseDir?: string) {
    const dir = baseDir ?? ".gemork";
    this.filePath = join(dir, projectId, "inbox.json");
    this.load();
  }

  addItem(item: InboxItem): void {
    this.items.push(item);
    this.persist();
  }

  getItem(id: string): InboxItem | null {
    return this.items.find((item) => item.id === id) ?? null;
  }

  getPendingItems(): InboxItem[] {
    return this.items.filter((item) => item.status === "pending");
  }

  resolveItem(id: string, response?: unknown): void {
    const item = this.items.find((item) => item.id === id);
    if (!item) throw new Error(`Inbox item ${id} not found`);
    if (item.status !== "pending") {
      throw new Error(`Inbox item ${id} is already ${item.status}`);
    }
    item.status = "resolved";
    item.resolvedAt = new Date();
    (item as any).response = response;
    this.persist();
  }

  cancelItem(id: string): void {
    const item = this.items.find((item) => item.id === id);
    if (!item) throw new Error(`Inbox item ${id} not found`);
    if (item.status !== "pending") {
      throw new Error(`Inbox item ${id} is already ${item.status}`);
    }
    item.status = "cancelled";
    item.resolvedAt = new Date();
    this.persist();
  }

  getStats(): InboxStats {
    return {
      pending: this.items.filter((i) => i.status === "pending").length,
      resolved: this.items.filter((i) => i.status === "resolved").length,
      cancelled: this.items.filter((i) => i.status === "cancelled").length,
    };
  }

  getAll(): InboxItem[] {
    return [...this.items];
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        const data = JSON.parse(raw);
        this.items = (data.items ?? []).map((item: any) => ({
          ...item,
          createdAt: new Date(item.createdAt),
          resolvedAt: item.resolvedAt ? new Date(item.resolvedAt) : undefined,
        }));
      }
    } catch {
      this.items = [];
    }
  }

  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify({ items: this.items }, null, 2));
  }
}
