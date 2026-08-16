import { Link } from 'react-router-dom';

import { Button } from '../components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <p className="text-6xl font-bold text-muted-foreground/30">404</p>
      <h2 className="mt-4 text-lg font-semibold text-foreground">Page not found</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        The page you are looking for does not exist or has been moved.
      </p>
      <Button asChild className="mt-6">
        <Link to="/">Go Home</Link>
      </Button>
    </div>
  );
}
