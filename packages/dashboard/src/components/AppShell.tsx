import { GitBranch, Menu, PanelLeftClose, PanelLeftOpen, Zap } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { cn } from '@/lib/utils';

import { useEventStream } from '../hooks/use-event-stream';
import { useGlobalNotifications } from '../hooks/use-global-notifications';

import { AppBreadcrumb } from './AppBreadcrumb';
import { InitBanner } from './InitBanner';
import { NotificationToggle } from './NotificationToggle';
import { SystemStatusIndicator } from './SystemStatusIndicator';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';

const NAV_ITEMS = [
  { to: '/runs', label: 'Runs', icon: Zap },
  { to: '/workflows', label: 'Workflows', icon: GitBranch },
] as const;

function isNavActive(pathname: string, to: string) {
  if (to === '/runs') {
    return pathname === '/' || pathname.startsWith('/runs');
  }
  return pathname.startsWith(to);
}

function NavItems({
  pathname,
  collapsed,
  onNavigate,
}: Readonly<{
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}>) {
  return (
    <nav aria-label="Main navigation" className="flex-1 space-y-1 px-2 py-3">
      {NAV_ITEMS.map((item) => {
        const active = isNavActive(pathname, item.to);
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-all duration-150',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
              collapsed && 'relative justify-center px-2',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {collapsed && active && (
              <span className="absolute bottom-1 size-1 rounded-full bg-primary" />
            )}
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function AppShell() {
  const { status, events } = useEventStream();
  const { permission, requestPermission, supported } = useGlobalNotifications(events);
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden flex-col border-r border-sidebar-border bg-gradient-to-b from-sidebar to-sidebar/80 transition-[width] duration-200 lg:flex',
          collapsed ? 'w-16' : 'w-56',
        )}
      >
        <div
          className={cn(
            'flex items-center border-b border-border py-4',
            collapsed ? 'justify-center px-2' : 'justify-between px-4',
          )}
        >
          {!collapsed && (
            <div className="flex flex-col">
              <h1 className="text-xs font-bold tracking-wide text-sidebar-foreground">
                AI Dev Orchestrator
              </h1>
              <span className="text-[10px] text-muted-foreground/50">v{__APP_VERSION__}</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setCollapsed((c) => !c);
            }}
            className="shrink-0 text-muted-foreground"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </Button>
        </div>

        <NavItems pathname={pathname} collapsed={collapsed} />

        <div
          className={cn(
            'space-y-2 border-t border-white/[0.04] py-3',
            collapsed ? 'flex flex-col items-center px-2' : 'px-3',
          )}
        >
          <NotificationToggle
            permission={permission}
            supported={supported}
            collapsed={collapsed}
            onRequestPermission={() => void requestPermission()}
          />
          {collapsed ? (
            <SystemStatusIndicator sseStatus={status} dotOnly />
          ) : (
            <SystemStatusIndicator sseStatus={status} />
          )}
        </div>
      </aside>

      {/* Mobile sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b border-border px-4 py-4">
            <SheetTitle className="text-sm font-bold tracking-wide">AI Dev Orchestrator</SheetTitle>
          </SheetHeader>
          <NavItems
            pathname={pathname}
            collapsed={false}
            onNavigate={() => {
              setMobileOpen(false);
            }}
          />
          <div className="space-y-2 border-t border-white/[0.04] px-4 py-3">
            <NotificationToggle
              permission={permission}
              supported={supported}
              onRequestPermission={() => void requestPermission()}
            />
            <SystemStatusIndicator sseStatus={status} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-12 items-center gap-3 bg-background/80 px-4 shadow-[0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => {
              setMobileOpen(true);
            }}
            aria-label="Open navigation menu"
          >
            <Menu className="size-5" />
          </Button>
          <Separator orientation="vertical" className="h-5 lg:hidden" />
          <AppBreadcrumb />
        </header>

        <InitBanner />
        <main id="main" className="flex-1 overflow-auto bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
