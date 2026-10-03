import { useEffect, useState, type ReactNode } from "react";

export type Destination = "overview" | "testset" | "results" | "workflow" | "compare";
const destinations: { id: Destination; label: string; path: string }[] = [
  { id: "overview", label: "Overview", path: "M2.5 7L8 2.5 13.5 7v6.5h-11z M6.5 13.5v-4h3v4" },
  { id: "testset", label: "Test set", path: "M6 2.5h4 M6.5 2.5v4L3 13h10L9.5 6.5v-4 M4.5 10h7" },
  { id: "results", label: "Results", path: "M5.5 4h8 M5.5 8h8 M5.5 12h8 M2.5 4h.1 M2.5 8h.1 M2.5 12h.1" },
  { id: "workflow", label: "Workflow", path: "M5 12.5h4a2.5 2.5 0 000-5H7a2.5 2.5 0 010-5h4 M3.5 11v3 M12.5 2v3" },
  { id: "compare", label: "Compare", path: "M5 2.5v11 M11 2.5v11 M2.5 6H5 M11 10h2.5" },
];
function NavIcon({ path }: { path: string }) {
  return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function LogoMark({ size = 22 }: { size?: number }) {
  const small = size < 32;
  return <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
    <path d="M4 19h24v3.5h-4c-1.8 0-2.5 1-2.5 2.6V26H24v3.5H8V26h2.5v-.9c0-1.6-.7-2.6-2.5-2.6H4z" fill="var(--text)" />
    <path d="M13.5 11.8L9 7M16 11v-4.5" stroke="var(--text)" strokeWidth={small ? 3 : 2.6} strokeLinecap="round" opacity={small ? 0.6 : 0.4} />
    <path d="M16 14.5l8.5-9" stroke="var(--accent)" strokeWidth="3.2" strokeLinecap="round" />
    <circle cx="16" cy="14.5" r="3" fill="var(--accent)" />
  </svg>;
}
function Wordmark({ compact = false }: { compact?: boolean }) {
  return <span className="wordmark"><LogoMark />{!compact && <span>Pathsmith</span>}</span>;
}
function NavItems({ active, navigate }: { active: Destination; navigate: (to: Destination) => void }) {
  return destinations.map(({ id, label, path }) => <button key={id} type="button" className={`shell-nav-item ${active === id ? "is-active" : ""}`} title={label} aria-label={label} aria-current={active === id ? "page" : undefined} onClick={() => navigate(id)}>
    <span className="shell-nav-icon"><NavIcon path={path} /></span><span className="shell-nav-label">{label}</span>
  </button>);
}
export default function AppShell({ active, navigate, projectName, workflowName, version, health, liveArmed, children }: {
  active: Destination; navigate: (to: Destination) => void; projectName: string; workflowName?: string; version?: string; health: string; liveArmed: boolean; children: ReactNode;
}) {
  const [theme, setTheme] = useState<"dark" | "light">(() => window.localStorage.getItem("pathsmith.theme") === "light" ? "light" : "dark");
  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem("pathsmith.theme", theme); }, [theme]);
  return <div className="app-shell">
    <aside className="shell-sidebar">
      <div className="shell-brand"><Wordmark /></div>
      <nav className="shell-nav" aria-label="Project"><NavItems active={active} navigate={navigate} /></nav>
      <div className="shell-footer"><span className="shell-health"><span className="dot" />{health}</span><span>Local workspace</span></div>
    </aside>
    <div className="shell-column">
      <header className="shell-header"><div className="shell-mobile-brand"><Wordmark compact /></div><div className="shell-crumbs"><span>{projectName}</span>{workflowName && <><span aria-hidden="true">›</span><span>{workflowName}</span></>}{version && <code>{version}</code>}<span aria-hidden="true">›</span><strong>{destinations.find((item) => item.id === active)?.label}</strong></div><button className="theme-switch" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? "☼" : "☾"}</button></header>
      {liveArmed && <div className="shell-live" role="status"><strong>⚡ Live setup selected</strong><span>External provider requests require fresh confirmation in run setup.</span></div>}
      <main id="app-main" className="shell-main">{children}</main>
      <nav className="shell-mobile-nav" aria-label="Project"><NavItems active={active} navigate={navigate} /></nav>
    </div>
  </div>;
}
