import type { ReactNode } from "react";
import "./ui.css";

export type StateTone = "neutral" | "error";

interface StateCardProps {
  readonly tone?: StateTone;
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
  /** `alert` for errors that replace the page, `status` for passive states. */
  readonly role?: "alert" | "status";
}

const ICONS: Record<StateTone, string> = {
  neutral: "M4 6h16v12H4zM4 10h16M10 6v12",
  error: "M12 3 2 21h20zM12 10v5M12 18v.01",
};

/** A designed empty, loading or error state: icon, title, explanation and actions. */
export function StateCard({ tone = "neutral", title, children, actions, role }: StateCardProps) {
  return (
    <div className={`sm-state sm-state--${tone}`} role={role}>
      <svg
        className="sm-state__icon"
        viewBox="0 0 24 24"
        width="32"
        height="32"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={ICONS[tone]} />
      </svg>
      <h2 className="sm-state__title">{title}</h2>
      {children === undefined ? null : <div className="sm-state__body">{children}</div>}
      {actions === undefined ? null : <div className="sm-state__actions">{actions}</div>}
    </div>
  );
}

/** A spinner that stops under prefers-reduced-motion; the text beside it carries the meaning. */
export function Spinner() {
  return <span className="sm-spinner" aria-hidden="true" />;
}
