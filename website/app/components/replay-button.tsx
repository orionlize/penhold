'use client';

export const REPLAY_EVENT = 'penhold:replay';

export function ReplayButton({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <a className={className} href="#demo" onClick={() => window.dispatchEvent(new Event(REPLAY_EVENT))}>
      {children}
    </a>
  );
}
