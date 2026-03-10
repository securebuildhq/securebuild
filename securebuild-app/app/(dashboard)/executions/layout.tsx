import { ReactNode } from 'react';

interface ExecutionsLayoutProps {
  children: ReactNode;
}

export default function ExecutionsLayout({ children }: ExecutionsLayoutProps) {
  // Session and layout are handled by the parent dashboard layout
  return <>{children}</>;
}
