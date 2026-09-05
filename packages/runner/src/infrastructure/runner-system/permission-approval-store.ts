import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { PermissionApprovalEntry, PermissionApprovalFile } from '@ai-dev-orchestrator/schemas';
import { permissionApprovalFileSchema } from '@ai-dev-orchestrator/schemas';

export interface PermissionApprovalStore {
  findMatch(action: string, resource: string): PermissionApprovalEntry | undefined;
  record(entry: Omit<PermissionApprovalEntry, 'id' | 'createdAt'>): Promise<void>;
  list(): readonly PermissionApprovalEntry[];
  remove(id: string): Promise<boolean>;
  clear(): Promise<void>;
  reload(): Promise<void>;
}

export class FileBackedPermissionApprovalStore implements PermissionApprovalStore {
  private readonly filePath: string;
  private cache: PermissionApprovalFile | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  findMatch(action: string, resource: string): PermissionApprovalEntry | undefined {
    const data = this.getCached();
    if (!data) {
      return undefined;
    }
    return data.approvals.find(
      (entry) => entry.action === action && resource.startsWith(entry.resource),
    );
  }

  async record(entry: Omit<PermissionApprovalEntry, 'id' | 'createdAt'>): Promise<void> {
    await this.ensureLoaded();
    const data = this.cache ?? { version: 1 as const, approvals: [] as PermissionApprovalEntry[] };

    const duplicate = data.approvals.find(
      (existing) => existing.action === entry.action && existing.resource === entry.resource,
    );
    if (duplicate) {
      return;
    }

    const newEntry: PermissionApprovalEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    (data.approvals as PermissionApprovalEntry[]).push(newEntry);
    this.cache = data;
    await this.atomicWrite(data);
  }

  list(): readonly PermissionApprovalEntry[] {
    const data = this.getCached();
    return data?.approvals ?? [];
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const data = this.cache ?? { version: 1 as const, approvals: [] as PermissionApprovalEntry[] };
    const idx = data.approvals.findIndex((e) => e.id === id);
    if (idx === -1) {
      return false;
    }
    (data.approvals as PermissionApprovalEntry[]).splice(idx, 1);
    this.cache = data;
    await this.atomicWrite(data);
    return true;
  }

  async clear(): Promise<void> {
    this.cache = { version: 1 as const, approvals: [] };
    await this.atomicWrite(this.cache);
  }

  async reload(): Promise<void> {
    this.cache = null;
    await this.ensureLoaded();
  }

  private getCached(): PermissionApprovalFile | null {
    return this.cache;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.cache) {
      return;
    }
    try {
      const content = await readFile(this.filePath, 'utf-8');
      const parsed = permissionApprovalFileSchema.safeParse(JSON.parse(content));
      if (parsed.success) {
        this.cache = { version: parsed.data.version, approvals: [...parsed.data.approvals] };
      } else {
        this.cache = { version: 1 as const, approvals: [] };
      }
    } catch {
      this.cache = { version: 1 as const, approvals: [] };
    }
  }

  private async atomicWrite(data: PermissionApprovalFile): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmpPath = join(dir, `.permission-approvals-${randomUUID()}.tmp`);
    await writeFile(tmpPath, JSON.stringify(data, null, 2));
    await rename(tmpPath, this.filePath);
  }
}
