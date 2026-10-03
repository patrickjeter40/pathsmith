import type { ReactNode } from "react";
import type { Mode } from "./screenTypes";

export type IconName = "check" | "x" | "alert" | "bang" | "question" | "dash" | "play" | "replay" | "cube" | "bolt" | "chevron" | "plus" | "arrow" | "route" | "list" | "compare" | "save";
export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, ReactNode> = {
    check: <path d="M3.5 8.5l3 3 6-7" {...p} />,
    x: <path d="M4 4l8 8M12 4l-8 8" {...p} />,
    alert: <><path d="M8 2.5l6 11H2z" {...p} /><path d="M8 7v2.5M8 11.6v.1" {...p} /></>,
    bang: <><circle cx="8" cy="8" r="5.5" {...p} /><path d="M8 5v3.5M8 10.8v.1" {...p} /></>,
    question: <><circle cx="8" cy="8" r="5.5" {...p} /><path d="M6.5 6.5a1.5 1.5 0 113 .3c-.4.6-1.5.9-1.5 1.9M8 10.9v.1" {...p} /></>,
    dash: <path d="M4.5 8h7" {...p} />,
    play: <path d="M5 3.5l7 4.5-7 4.5z" {...p} />,
    replay: <><path d="M3 8a5 5 0 109-3" {...p} /><path d="M12 2v3H9" {...p} /></>,
    cube: <><path d="M8 2l5.5 3v6L8 14l-5.5-3V5z" {...p} /><path d="M2.5 5L8 8l5.5-3M8 8v6" {...p} /></>,
    bolt: <path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" {...p} />,
    chevron: <path d="M6 4l4 4-4 4" {...p} />,
    plus: <path d="M8 3.5v9M3.5 8h9" {...p} />,
    arrow: <path d="M3 8h10M9 4l4 4-4 4" {...p} />,
    route: <><circle cx="3.5" cy="12.5" r="1.5" {...p} /><circle cx="12.5" cy="3.5" r="1.5" {...p} /><path d="M5 12.5h4a2.5 2.5 0 000-5H7a2.5 2.5 0 010-5h4" {...p} /></>,
    list: <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.1M2.5 8h.1M2.5 12h.1" {...p} />,
    compare: <><path d="M5 2.5v11M11 2.5v11" {...p} /><path d="M2.5 6H5M11 10h2.5" {...p} /></>,
    save: <><path d="M3 2.5h8l2 2v9H3z" {...p} /><path d="M5.5 2.5v3h5v-3M5.5 13.5v-4h5v4" {...p} /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 16 16" width={size} height={size}>{paths[name]}</svg>;
}
export function ModeBadge({ mode, short = true }: { mode: string; short?: boolean }) {
  const value: Mode = mode === "live" || mode === "replay" ? mode : "mock";
  const meta = { mock: { icon: "cube", label: "Mock", sub: "Offline" }, replay: { icon: "replay", label: "Recorded Replay", sub: "No new provider calls" }, live: { icon: "bolt", label: "Live", sub: "External requests" } } as const;
  return <span className={`mode-badge mode-badge-${value}`}><Icon name={meta[value].icon} size={12} />{meta[value].label}{!short && <small> / {meta[value].sub}</small>}</span>;
}
export function StatusPill({ kind, children }: { kind: "success" | "regress" | "error" | "warn" | "unknown" | "unvisited" | "accent"; children: ReactNode }) {
  const icon: IconName = { success: "check", regress: "x", error: "bang", warn: "alert", unknown: "question", unvisited: "dash", accent: "replay" }[kind] as IconName;
  return <span className={`status-pill status-pill-${kind}`}><Icon name={icon} size={12} />{children}</span>;
}
export function Panel({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`screen-panel ${className}`}>{title && <div className="screen-panel-head"><h3>{title}</h3></div>}{children}</section>;
}
export function RateMetric({ label, numerator, denominator, note, tone = "success" }: { label: string; numerator: number; denominator: number; note?: string; tone?: string }) {
  const percentage = denominator ? Math.round(numerator / denominator * 100) : null;
  return <div className="rate-metric"><div>{label}</div><strong>{percentage === null ? "N/A" : `${percentage}%`}</strong><code>{numerator} / {denominator}</code><div className="rate-track"><span className={`rate-fill tone-${tone}`} style={{ width: `${percentage ?? 0}%` }} /></div>{note && <small>{note}</small>}</div>;
}
export function StepBar({ step, onStep }: { step: number; onStep: (step: number) => void }) {
  return <ol className="step-bar">{["Examples", "Review labels", "Run", "Inspect"].map((label, index) => <li key={label}><button onClick={() => onStep(index)} aria-current={step === index ? "step" : undefined} className={step === index ? "current" : index < step ? "done" : ""}><span>{index < step ? <Icon name="check" size={12} /> : index + 1}</span>{label}</button>{index < 3 && <i aria-hidden="true" />}</li>)}</ol>;
}
