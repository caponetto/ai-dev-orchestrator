import { Loader2 } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';

import { AppShell } from './components/AppShell';
import { NotFoundPage } from './pages/NotFoundPage';

const RunListPage = lazy(() =>
  import('./pages/RunListPage').then((m) => ({ default: m.RunListPage })),
);
const NewRunPage = lazy(() =>
  import('./pages/NewRunPage').then((m) => ({ default: m.NewRunPage })),
);
const RunDetailPage = lazy(() =>
  import('./pages/RunDetailPage').then((m) => ({ default: m.RunDetailPage })),
);
const HealthPage = lazy(() =>
  import('./pages/HealthPage').then((m) => ({ default: m.HealthPage })),
);
const WorkflowsPage = lazy(() =>
  import('./pages/WorkflowsPage').then((m) => ({ default: m.WorkflowsPage })),
);

export function App() {
  return (
    <>
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center bg-background">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/runs" replace />} />
            <Route path="runs" element={<RunListPage />} />
            <Route path="runs/new" element={<NewRunPage />} />
            <Route path="runs/:runId" element={<RunDetailPage />} />
            <Route path="health" element={<HealthPage />} />
            <Route path="workflows" element={<WorkflowsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </>
  );
}
