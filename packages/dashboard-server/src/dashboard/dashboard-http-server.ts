import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

import type {
  AgentStreamBus,
  DashboardActionHandler,
  DashboardDataProvider,
  EventCapableDataProvider,
  HistoryCapableStreamBus,
  Logger,
  SessionCapableDataProvider,
  SettingsProvider,
} from '@ai-dev-orchestrator/ports';
import type { LiveRequestStore, PermissionApprovalStore } from '@ai-dev-orchestrator/runner';
import type {
  ArtifactType,
  DashboardEvent,
  DashboardEventType,
  RunSettings,
} from '@ai-dev-orchestrator/schemas';
import { ARTIFACTS_DIR_NAME, MEDIA_MIME_TYPES } from '@ai-dev-orchestrator/schemas';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { SseEventStream } from './sse-event-stream';

interface DashboardServerConfig {
  readonly port: number;
  readonly host: string;
  readonly runsDir?: string;
  readonly scriptsDir?: string;
}

const DEFAULT_DASHBOARD_CONFIG: DashboardServerConfig = {
  port: 9100,
  host: '127.0.0.1',
};

export interface DashboardHttpServerOptions {
  readonly config: Partial<DashboardServerConfig>;
  readonly dataProvider: DashboardDataProvider;
  readonly eventStream: SseEventStream;
  readonly agentStreamBus?: AgentStreamBus;
  readonly liveRequestStore?: LiveRequestStore;
  readonly actionHandler?: DashboardActionHandler;
  readonly settingsProvider?: SettingsProvider;
  readonly approvalStore?: PermissionApprovalStore;
  readonly logger?: Logger;
}

export class DashboardHttpServer {
  private server: Server | null = null;
  private readonly config: DashboardServerConfig;
  private readonly dataProvider: DashboardDataProvider;
  private readonly eventStream: SseEventStream;
  private readonly agentStreamBus?: AgentStreamBus;
  private readonly liveRequestStore?: LiveRequestStore;
  private readonly actionHandler?: DashboardActionHandler;
  private readonly settingsProvider?: SettingsProvider;
  private readonly approvalStore?: PermissionApprovalStore;
  private readonly logger?: Logger;
  private readonly app: Hono;
  private readonly sseClientIds = new Set<string>();
  private readonly sseResponses = new Set<ServerResponse>();
  private readonly startedAt = Date.now();

  constructor(options: DashboardHttpServerOptions) {
    this.config = { ...DEFAULT_DASHBOARD_CONFIG, ...options.config };
    this.dataProvider = options.dataProvider;
    this.eventStream = options.eventStream;
    this.agentStreamBus = options.agentStreamBus;
    this.liveRequestStore = options.liveRequestStore;
    this.actionHandler = options.actionHandler;
    this.settingsProvider = options.settingsProvider;
    this.approvalStore = options.approvalStore;
    this.logger = options.logger;
    this.app = new Hono();
    this.registerMiddleware();
    this.registerRoutes();
    this.bridgeAgentStreamEvents();
  }

  async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const listener = getRequestListener(this.app.fetch);
      this.server = createServer((req, res) => {
        if (req.url?.startsWith('/events') && req.method === 'GET') {
          this.sseResponses.add(res);
          res.on('close', () => this.sseResponses.delete(res));
        }
        void listener(req, res);
      });
      this.server.on('error', (err) => {
        this.logger?.error(`Server error: ${err.message}`);
        reject(err);
      });
      this.server.listen(this.config.port, this.config.host, () => {
        this.logger?.info(
          `Dashboard server started on ${this.config.host}:${String(this.config.port)}`,
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.logger?.info('Dashboard server stopping...');
    for (const clientId of this.sseClientIds) {
      this.eventStream.unsubscribe(clientId);
    }
    this.sseClientIds.clear();

    for (const res of this.sseResponses) {
      if (!res.writableEnded) {
        res.end();
      }
    }
    this.sseResponses.clear();

    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.closeAllConnections();
      this.server.close(() => {
        this.server = null;
        this.logger?.info('Dashboard server stopped');
        resolve();
      });
    });
  }

  getClientCount(): number {
    return this.sseClientIds.size;
  }

  getPort(): number {
    const address = this.server?.address();
    if (address && typeof address === 'object') {
      return address.port;
    }
    return this.config.port;
  }

  private bridgeAgentStreamEvents(): void {
    if (!this.agentStreamBus) {
      return;
    }
    this.agentStreamBus.subscribe((event) => {
      if (
        event.type === 'permission_request' &&
        event.structuredData?.['messageType'] !== 'permission_resolved'
      ) {
        this.eventStream.publish({
          type: 'permission_requested',
          timestamp: event.timestamp,
          runId: event.runId,
          data: {
            messageId: event.requestMessageId,
            ...event.structuredData,
          },
        });
      }
      if (event.type === 'clarification_request') {
        this.eventStream.publish({
          type: 'clarification_requested',
          timestamp: event.timestamp,
          runId: event.runId,
          data: {
            messageId: event.requestMessageId,
            ...event.structuredData,
          },
        });
      }
    });
  }

  private publishHealthChanged(): void {
    setTimeout(() => {
      this.eventStream.publish({
        type: 'health_changed',
        timestamp: new Date().toISOString(),
      });
    }, 0);
  }

  private registerMiddleware(): void {
    this.app.use('*', async (c, next) => {
      c.header('Access-Control-Allow-Origin', '*');
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type');
      if (c.req.method === 'OPTIONS') {
        return c.body(null, 204);
      }
      const start = Date.now();
      await next();
      const durationMs = Date.now() - start;
      this.logger?.debug(
        `${c.req.method} ${c.req.path} ${String(c.res.status)} ${String(durationMs)}ms`,
      );
    });
  }

  private registerRoutes(): void {
    this.app.get('/events', (c) => {
      return streamSSE(c, async (stream) => {
        const typesParam = c.req.query('types');
        const typeFilter = typesParam?.split(',') as DashboardEventType[] | undefined;
        const runIdFilter = c.req.query('runId');

        const clientId = this.eventStream.subscribe((event: DashboardEvent) => {
          if (typeFilter && !typeFilter.includes(event.type)) {
            return;
          }
          if (runIdFilter && event.runId !== runIdFilter) {
            return;
          }
          void stream.writeSSE({ data: JSON.stringify(event) });
        });

        this.sseClientIds.add(clientId);
        this.logger?.debug(`SSE client connected (${String(this.sseClientIds.size)} active)`);
        this.publishHealthChanged();

        await new Promise<void>((resolve) => {
          stream.onAbort(() => {
            this.eventStream.unsubscribe(clientId);
            this.sseClientIds.delete(clientId);
            this.logger?.debug(
              `SSE client disconnected (${String(this.sseClientIds.size)} active)`,
            );
            this.publishHealthChanged();
            resolve();
          });
        });
      });
    });

    this.app.get('/api/health', (c) => {
      const healthResult = this.dataProvider.getSystemHealth();
      const systemHealth = healthResult.ok ? healthResult.value : null;
      const historyResult = this.dataProvider.getRunHistory();
      const runs = historyResult.ok ? historyResult.value : [];
      const active = runs.filter((r) => r.status === 'running' || r.status === 'waiting').length;
      const completed = runs.filter((r) => r.status === 'completed').length;
      const failed = runs.filter((r) => r.status === 'failed' || r.status === 'aborted').length;
      const durations = runs.filter((r) => r.durationMs > 0).map((r) => r.durationMs);
      const avgDurationMs =
        durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : null;
      const latestRun =
        runs.length > 0
          ? runs.reduce(
              (latest, r) => (r.startedAt > latest ? r.startedAt : latest),
              runs[0].startedAt,
            )
          : null;
      const totalInputTokens = runs.reduce((sum, r) => sum + r.totalInputTokens, 0);
      const totalOutputTokens = runs.reduce((sum, r) => sum + r.totalOutputTokens, 0);
      return c.json({
        status: systemHealth?.overallStatus ?? 'ok',
        clients: this.getClientCount(),
        subsystems: systemHealth?.subsystems ?? [],
        timestamp: systemHealth?.timestamp ?? new Date().toISOString(),
        uptimeMs: Date.now() - this.startedAt,
        port: this.getPort(),
        host: this.config.host,
        runStats: {
          total: runs.length,
          active,
          completed,
          failed,
          avgDurationMs,
          latestRun,
          totalInputTokens,
          totalOutputTokens,
        },
      });
    });

    this.app.get('/api/runs/:runId/state', (c) => {
      const result = this.dataProvider.getRunState(c.req.param('runId'));
      if (result.ok) {
        return c.json(result.value);
      }
      return c.json({ error: result.error.message }, 404);
    });

    this.app.get('/api/runs/:runId/workflow', (c) => {
      const result = this.dataProvider.getWorkflowView(c.req.param('runId'));
      if (result.ok) {
        return c.json(result.value);
      }
      return c.json({ error: result.error.message }, 404);
    });

    this.app.get('/api/runs/:runId/iterations', (c) => {
      const result = this.dataProvider.getIterationView(c.req.param('runId'));
      if (result.ok) {
        return c.json(result.value);
      }
      return c.json({ error: result.error.message }, 404);
    });

    this.app.get('/api/runs/:runId/findings', (c) => {
      const result = this.dataProvider.getFindingsView(c.req.param('runId'));
      if (result.ok) {
        return c.json(result.value);
      }
      return c.json({ error: result.error.message }, 404);
    });

    this.app.get('/api/runs/:runId/usage', (c) => {
      const result = this.dataProvider.getUsageView(c.req.param('runId'));
      if (result.ok) {
        return c.json(result.value);
      }
      return c.json({ error: result.error.message }, 404);
    });

    this.app.get('/api/runs/:runId/artifacts', (c) => {
      const result = this.dataProvider.getArtifactView(c.req.param('runId'));
      if (result.ok) {
        return c.json(result.value);
      }
      return c.json({ error: result.error.message }, 404);
    });

    this.app.get('/api/runs/:runId/config', (c) => {
      const runId = c.req.param('runId');
      const config = this.dataProvider.getRunConfig(runId);
      if (config) {
        return c.json(config);
      }
      return c.json({ error: 'Config snapshot unavailable for this run' }, 404);
    });

    this.app.get('/api/runs/:runId/events', (c) => {
      const provider = this.dataProvider as Partial<EventCapableDataProvider>;
      return c.json(provider.getRunEvents?.(c.req.param('runId')) ?? []);
    });

    this.app.get('/api/runs/:runId/artifacts/:type/:name/:version/detail', (c) => {
      const runId = c.req.param('runId');
      const type = c.req.param('type');
      const name = c.req.param('name');
      const version = parseInt(c.req.param('version'), 10);
      if (isNaN(version)) {
        return c.json({ error: 'Invalid version' }, 400);
      }
      const result = this.dataProvider.getArtifactDetail(runId, {
        type: type as ArtifactType,
        name,
        version,
        checksum: '',
      });
      if (result.ok) {
        return c.json(result.value);
      }
      return c.json({ error: result.error.message }, 404);
    });

    this.app.get('/api/runs/:runId/artifacts/:type/:name/:version/content', (c) => {
      const runId = c.req.param('runId');
      const type = c.req.param('type');
      const name = c.req.param('name');
      const version = parseInt(c.req.param('version'), 10);
      if (isNaN(version)) {
        return c.json({ error: 'Invalid version' }, 400);
      }
      const result = this.dataProvider.getArtifactContent(runId, type, name, version);
      if (result.ok) {
        return c.json(result.value);
      }
      return c.json({ error: result.error.message }, 404);
    });

    this.app.get('/api/scripts/:name/content', (c) => {
      if (!this.config.scriptsDir) {
        return c.json({ error: 'Scripts directory not configured' }, 404);
      }
      const name = c.req.param('name');
      if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
        return c.json({ error: 'Invalid script name' }, 400);
      }
      const scriptPath = join(this.config.scriptsDir, name);
      if (!existsSync(scriptPath) || !statSync(scriptPath).isFile()) {
        return c.json({ error: 'Script not found' }, 404);
      }
      const content = readFileSync(scriptPath, 'utf-8');
      const contentType = name.endsWith('.ts') || name.endsWith('.js') ? 'code' : 'text';
      return c.json({ content, contentType });
    });

    this.app.get('/api/runs/:runId/files/*', (c) => {
      if (!this.config.runsDir) {
        return c.json({ error: 'File serving not configured' }, 404);
      }
      const runId = c.req.param('runId');
      const filePath = c.req.path.replace(`/api/runs/${runId}/files/`, '');
      if (!filePath || filePath.includes('..')) {
        return c.json({ error: 'Invalid path' }, 400);
      }

      const artifactsDir = resolve(this.config.runsDir, runId, ARTIFACTS_DIR_NAME);
      const fullPath = normalize(join(artifactsDir, filePath));
      if (!fullPath.startsWith(artifactsDir)) {
        return c.json({ error: 'Path traversal denied' }, 403);
      }

      if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
        return c.json({ error: 'File not found' }, 404);
      }

      const ext = extname(fullPath).toLowerCase();
      const contentType = MEDIA_MIME_TYPES[ext] ?? 'application/octet-stream';
      const fileContent = readFileSync(fullPath);

      return new Response(fileContent, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(fileContent.length),
          'Cache-Control': 'public, max-age=86400',
        },
      });
    });

    this.app.get('/api/runs/:runId/agent-stream', (c) => {
      if (!this.agentStreamBus) {
        return c.json({ error: 'Agent streaming not configured' }, 404);
      }
      const bus = this.agentStreamBus;
      return streamSSE(c, async (stream) => {
        const runId = c.req.param('runId');
        const historyBus = bus as Partial<HistoryCapableStreamBus>;
        for (const event of historyBus.getRunHistory?.(runId) ?? []) {
          void stream.writeSSE({ data: JSON.stringify(event) });
        }
        const clientId = bus.subscribe((event) => {
          if (event.runId !== runId) {
            return;
          }
          void stream.writeSSE({ data: JSON.stringify(event) });
        });

        await new Promise<void>((resolve) => {
          stream.onAbort(() => {
            bus.unsubscribe(clientId);
            resolve();
          });
        });
      });
    });

    this.app.get('/api/runs', (c) => {
      const result = this.dataProvider.getRunHistory();
      if (result.ok) {
        const limitParam = c.req.query('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : 50;
        const sorted = [...result.value].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        return c.json(sorted.slice(0, limit));
      }
      return c.json({ error: result.error.message }, 404);
    });

    this.app.get('/api/runs/:runId/sessions', (c) => {
      const runId = c.req.param('runId');
      const sessionProvider = this.dataProvider as Partial<SessionCapableDataProvider>;
      if (!sessionProvider.getSessionsView) {
        return c.json([]);
      }
      const result = sessionProvider.getSessionsView(runId);
      if (!result.ok) {
        return c.json({ error: result.error.message }, 500);
      }
      return c.json(result.value);
    });

    this.app.get('/api/runs/:runId/live-requests', async (c) => {
      if (!this.liveRequestStore) {
        return c.json({ error: 'Live request store not configured' }, 404);
      }
      const runId = c.req.param('runId');
      const pending = await this.liveRequestStore.listPendingRequests(runId);
      return c.json(pending);
    });

    this.app.post('/api/runs/:runId/permissions/:messageId', async (c) => {
      if (!this.liveRequestStore) {
        return c.json({ error: 'Live request store not configured' }, 404);
      }
      const runId = c.req.param('runId');
      const messageId = c.req.param('messageId');
      const body: { granted?: boolean } = await c.req.json();
      if (typeof body.granted !== 'boolean') {
        return c.json({ error: 'Body must include "granted" (boolean)' }, 400);
      }
      await this.liveRequestStore.writeResponse({
        runId,
        messageId,
        payload: { granted: body.granted },
        respondedAt: new Date().toISOString(),
      });
      this.eventStream.publish({
        type: 'permission_resolved',
        timestamp: new Date().toISOString(),
        runId,
        data: { messageId, granted: body.granted },
      });
      return c.json({ ok: true });
    });

    this.app.post('/api/runs/:runId/clarifications/:messageId', async (c) => {
      if (!this.liveRequestStore) {
        return c.json({ error: 'Live request store not configured' }, 404);
      }
      const runId = c.req.param('runId');
      const messageId = c.req.param('messageId');
      const body: { answer?: string } = await c.req.json();
      if (typeof body.answer !== 'string' || body.answer.length === 0) {
        return c.json({ error: 'Body must include "answer" (non-empty string)' }, 400);
      }
      await this.liveRequestStore.writeResponse({
        runId,
        messageId,
        payload: { answer: body.answer },
        respondedAt: new Date().toISOString(),
      });
      this.eventStream.publish({
        type: 'clarification_resolved',
        timestamp: new Date().toISOString(),
        runId,
        data: { messageId, answer: body.answer },
      });
      return c.json({ ok: true });
    });

    this.app.post('/api/runs/:runId/approve', async (c) => {
      if (!this.actionHandler) {
        return c.json({ success: false, error: 'Action handler not configured' }, 404);
      }
      const runId = c.req.param('runId');
      const body = (await c.req.json().catch(() => ({}))) as {
        message?: string;
        sessionId?: string;
      };
      const result = await this.actionHandler.approve(runId, {
        message: body.message,
        sessionId: body.sessionId,
      });
      return c.json(result, result.success ? 200 : 400);
    });

    this.app.post('/api/runs/:runId/reject', async (c) => {
      if (!this.actionHandler) {
        return c.json({ success: false, error: 'Action handler not configured' }, 404);
      }
      const runId = c.req.param('runId');
      const body = (await c.req.json().catch(() => ({}))) as {
        message?: string;
        sessionId?: string;
      };
      const result = await this.actionHandler.reject(runId, {
        message: body.message,
        sessionId: body.sessionId,
      });
      return c.json(result, result.success ? 200 : 400);
    });

    this.app.post('/api/runs/:runId/answer', async (c) => {
      if (!this.actionHandler) {
        return c.json({ success: false, error: 'Action handler not configured' }, 404);
      }
      const runId = c.req.param('runId');
      const body = (await c.req.json().catch(() => ({}))) as {
        content?: string;
        sessionId?: string;
      };
      if (typeof body.content !== 'string' || !body.content.trim()) {
        return c.json(
          { success: false, error: 'Body must include "content" (non-empty string)' },
          400,
        );
      }
      const result = await this.actionHandler.answer(runId, {
        content: body.content,
        sessionId: body.sessionId,
      });
      return c.json(result, result.success ? 200 : 400);
    });

    this.app.post('/api/runs/:runId/abort', async (c) => {
      if (!this.actionHandler) {
        return c.json({ success: false, error: 'Action handler not configured' }, 404);
      }
      const runId = c.req.param('runId');
      const body = (await c.req.json().catch(() => ({}))) as {
        force?: boolean;
        sessionId?: string;
        reason?: string;
      };
      const result = await this.actionHandler.abort(runId, {
        force: body.force,
        sessionId: body.sessionId,
        reason: body.reason,
      });
      return c.json(result, result.success ? 200 : 400);
    });

    this.app.post('/api/runs/:runId/retry', async (c) => {
      if (!this.actionHandler) {
        return c.json({ success: false, error: 'Action handler not configured' }, 404);
      }
      const runId = c.req.param('runId');
      const result = await this.actionHandler.retry(runId);
      return c.json(result, result.success ? 200 : 400);
    });

    this.app.delete('/api/runs/:runId', async (c) => {
      if (!this.actionHandler) {
        return c.json({ success: false, error: 'Action handler not configured' }, 404);
      }
      const runId = c.req.param('runId');
      const result = await this.actionHandler.deleteRun(runId);
      return c.json(result, result.success ? 200 : 400);
    });

    this.app.get('/api/workflows', (c) => {
      if (!this.actionHandler) {
        return c.json({ error: 'Action handler not configured' }, 404);
      }
      return c.json(this.actionHandler.listWorkflows());
    });

    this.app.get('/api/workflows/:name/preview', (c) => {
      if (!this.actionHandler) {
        return c.json({ error: 'Action handler not configured' }, 404);
      }
      const preview = this.actionHandler.getWorkflowPreview(c.req.param('name'));
      if (preview) {
        return c.json(preview);
      }
      return c.json({ error: 'Workflow not found' }, 404);
    });

    this.app.post('/api/runs', async (c) => {
      if (!this.actionHandler) {
        return c.json({ success: false, error: 'Action handler not configured' }, 404);
      }
      const body = (await c.req.json().catch(() => ({}))) as {
        prompt?: string;
        workflow?: string;
        repoRoot?: string;
        runSettings?: RunSettings;
      };
      if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
        return c.json(
          { success: false, error: 'Body must include "prompt" (non-empty string)' },
          400,
        );
      }
      if (body.runSettings) {
        if (!this.settingsProvider) {
          return c.json({ success: false, error: 'Settings provider not configured' }, 404);
        }
        const saveResult = this.settingsProvider.updateProjectSettings(body.runSettings);
        if (!saveResult.ok) {
          return c.json(
            { success: false, error: saveResult.error ?? 'Failed to save run configuration' },
            400,
          );
        }
      }
      const result = await this.actionHandler.createRun({
        prompt: body.prompt,
        workflow: body.workflow,
        repoRoot: body.repoRoot,
      });
      return c.json(result, result.success ? 200 : 400);
    });

    this.app.get('/api/browse-directory', async (c) => {
      if (process.env['NODE_ENV'] === 'test' || process.env['VITEST'] != null) {
        return c.json({ path: null, cancelled: true });
      }
      try {
        const { execSync } = await import('node:child_process');
        const platform = process.platform;
        let result: string | null = null;

        if (platform === 'darwin') {
          const raw = execSync(
            `osascript -e 'set theFolder to choose folder' -e 'return POSIX path of theFolder'`,
            { encoding: 'utf-8', timeout: 60_000 },
          ).trim();
          if (raw) {
            result = raw.replace(/\/$/, '');
          }
        } else if (platform === 'linux') {
          const raw = execSync(
            'zenity --file-selection --directory 2>/dev/null || kdialog --getexistingdirectory ~ 2>/dev/null',
            {
              encoding: 'utf-8',
              timeout: 60_000,
            },
          ).trim();
          if (raw) {
            result = raw;
          }
        } else if (platform === 'win32') {
          const raw = execSync(
            `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if($f.ShowDialog() -eq 'OK'){$f.SelectedPath}"`,
            { encoding: 'utf-8', timeout: 60_000 },
          ).trim();
          if (raw) {
            result = raw;
          }
        }

        if (result) {
          return c.json({ path: result });
        }
        return c.json({ path: null, cancelled: true });
      } catch {
        return c.json({ path: null, cancelled: true });
      }
    });

    this.app.get('/api/settings', (c) => {
      if (!this.settingsProvider) {
        return c.json({ error: 'Settings provider not configured' }, 404);
      }
      const settings = this.settingsProvider.getProjectSettings();
      if (!settings) {
        return c.json({ error: 'No project settings found' }, 404);
      }
      return c.json(settings);
    });

    this.app.put('/api/settings', async (c) => {
      if (!this.settingsProvider) {
        return c.json({ ok: false, error: 'Settings provider not configured' }, 404);
      }
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) {
        return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
      }
      const result = this.settingsProvider.updateProjectSettings(body);
      return c.json(result, result.ok ? 200 : 400);
    });

    this.app.get('/api/permission-approvals', (_c) => {
      if (!this.approvalStore) {
        return _c.json({ error: 'Approval store not configured' }, 404);
      }
      return _c.json(this.approvalStore.list());
    });

    this.app.delete('/api/permission-approvals/:id', async (c) => {
      if (!this.approvalStore) {
        return c.json({ error: 'Approval store not configured' }, 404);
      }
      const id = c.req.param('id');
      const removed = await this.approvalStore.remove(id);
      if (!removed) {
        return c.json({ error: 'Approval not found' }, 404);
      }
      return c.json({ ok: true });
    });

    this.app.delete('/api/permission-approvals', async (c) => {
      if (!this.approvalStore) {
        return c.json({ error: 'Approval store not configured' }, 404);
      }
      await this.approvalStore.clear();
      return c.json({ ok: true });
    });

    this.app.get('/api/server-info', (c) => {
      const initialized = this.config.runsDir ? existsSync(this.config.runsDir) : false;
      return c.json({ cwd: process.cwd(), initialized });
    });
  }
}
