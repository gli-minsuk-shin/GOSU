import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function StatusPill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}) {
  return (
    <span data-gosu-status={tone} className="gosu-status-pill">
      {children}
    </span>
  );
}

export function ActionButton({
  variant = 'secondary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return (
    <button
      {...props}
      data-gosu-variant={variant}
      className={['gosu-action', props.className].filter(Boolean).join(' ')}
    />
  );
}

export function ModuleState({
  state,
  title,
  detail,
  action,
}: {
  state: 'loading' | 'empty' | 'degraded' | 'error' | 'forbidden';
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <section
      className="gosu-module-state"
      data-state={state}
      role={state === 'error' ? 'alert' : 'status'}
    >
      <span aria-hidden="true">
        {state === 'loading' ? '◌' : state === 'forbidden' ? '▣' : '◇'}
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </section>
  );
}
