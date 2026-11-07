import type { ReactNode } from 'react';

export function TopBar({ title, back, right }: { title: ReactNode; back?: string; right?: ReactNode }) {
  return (
    <header className="topbar">
      {back ? (
        <a className="icon-btn" href={back} aria-label="Back">
          ‹
        </a>
      ) : (
        <span className="icon-spacer" />
      )}
      <h1>{title}</h1>
      {right ?? <span className="icon-spacer" />}
    </header>
  );
}

export const SHORT_NOTE = 70;
export const isShortNote = (n: string) => n.length <= SHORT_NOTE;
