import React from 'react';
import { Link, useLocation } from 'react-router-dom';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

interface Crumb {
  readonly label: string;
  readonly path?: string;
}

function buildCrumbs(pathname: string): Crumb[] {
  if (pathname === '/health') {
    return [{ label: 'Health' }];
  }

  if (pathname === '/workflows') {
    return [{ label: 'Workflows' }];
  }

  if (pathname === '/runs/new') {
    return [{ label: 'Runs', path: '/runs' }, { label: 'New Run' }];
  }

  const runMatch = /^\/runs\/([^/]+)$/.exec(pathname);
  if (runMatch) {
    return [{ label: 'Runs', path: '/runs' }, { label: runMatch[1] }];
  }

  if (pathname === '/' || pathname === '/runs') {
    return [{ label: 'Runs' }];
  }

  return [];
}

export function AppBreadcrumb() {
  const { pathname } = useLocation();
  const crumbs = buildCrumbs(pathname);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => (
          <React.Fragment key={crumb.path ?? crumb.label}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {i === crumbs.length - 1 ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={crumb.path ?? ''}>{crumb.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
