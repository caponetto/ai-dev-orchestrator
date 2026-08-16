import { Bell, BellOff, BellRing } from 'lucide-react';

import type { NotificationPermissionState } from '../hooks/use-global-notifications';
import { cn } from '../lib/utils';

import { Button } from './ui/button';

interface NotificationToggleProps {
  readonly permission: NotificationPermissionState;
  readonly supported: boolean;
  readonly collapsed?: boolean;
  readonly onRequestPermission: () => void;
}

const permissionConfig: Record<
  NotificationPermissionState,
  { icon: typeof Bell; label: string; description: string }
> = {
  granted: {
    icon: BellRing,
    label: 'Notifications on',
    description: 'Browser notifications enabled',
  },
  default: {
    icon: Bell,
    label: 'Enable notifications',
    description: 'Click to enable browser notifications',
  },
  denied: {
    icon: BellOff,
    label: 'Notifications blocked',
    description: 'Notifications blocked by browser — update in browser settings',
  },
};

export function NotificationToggle({
  permission,
  supported,
  collapsed,
  onRequestPermission,
}: NotificationToggleProps) {
  if (!supported) {
    return null;
  }

  const { icon: Icon, label, description } = permissionConfig[permission];
  const actionable = permission === 'default';

  if (collapsed) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!actionable}
        onClick={onRequestPermission}
        title={description}
        aria-label={label}
        className={cn(
          'text-muted-foreground',
          permission === 'granted' && 'text-emerald-500',
          permission === 'denied' && 'opacity-50',
        )}
      >
        <Icon className="size-4" />
      </Button>
    );
  }

  return (
    <button
      type="button"
      disabled={!actionable}
      onClick={onRequestPermission}
      title={description}
      className={cn(
        'flex w-full items-center gap-2 text-xs text-muted-foreground',
        actionable && 'cursor-pointer hover:text-foreground',
        !actionable && 'cursor-default',
      )}
    >
      <Icon
        className={cn(
          'size-3.5 shrink-0',
          permission === 'granted' && 'text-emerald-500',
          permission === 'denied' && 'opacity-50',
        )}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}
