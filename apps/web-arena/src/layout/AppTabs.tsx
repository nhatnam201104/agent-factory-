import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type AppTabId = "office" | "command" | "kanban" | "council";

export interface AppTabDef {
  id: AppTabId;
  label: string;
  badge?: number;
  /** Highlight the badge as something that needs the director's attention. */
  alert?: boolean;
}

const TAB_IDS: readonly AppTabId[] = ["office", "command", "kanban", "council"];
const DEFAULT_TAB: AppTabId = "office";

function readHashTab(): AppTabId {
  const hash = window.location.hash.replace(/^#/, "");
  return (TAB_IDS as readonly string[]).includes(hash) ? (hash as AppTabId) : DEFAULT_TAB;
}

/** Active tab persisted in the URL hash so it survives reloads and can be shared. */
export function useHashTab(): [AppTabId, (tab: AppTabId) => void] {
  const [tab, setTab] = useState<AppTabId>(readHashTab);

  useEffect(() => {
    const onHashChange = () => setTab(readHashTab());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const select = useCallback((next: AppTabId) => {
    setTab(next);
    if (window.location.hash !== `#${next}`) {
      window.history.replaceState(null, "", `#${next}`);
    }
  }, []);

  return [tab, select];
}

/** Keeps the `--header-h` CSS variable equal to the sticky header's real height. */
export function useHeaderHeight<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

export const tabId = (id: AppTabId) => `app-tab-${id}`;
export const panelId = (id: AppTabId) => `app-panel-${id}`;

export function AppTabs(props: {
  tabs: readonly AppTabDef[];
  active: AppTabId;
  onSelect: (id: AppTabId) => void;
}) {
  const { tabs, active, onSelect } = props;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === active);
    const moves: Record<string, number> = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const nextIndex = moves[e.key];
    const next = nextIndex === undefined ? undefined : tabs[nextIndex];
    if (!next) return;
    e.preventDefault();
    onSelect(next.id);
    document.getElementById(tabId(next.id))?.focus();
  };

  return (
    <div
      className="app-tabs"
      role="tablist"
      aria-label="Khu vực làm việc"
      onKeyDown={handleKeyDown}
    >
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            id={tabId(t.id)}
            type="button"
            role="tab"
            className="app-tab"
            data-testid={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={panelId(t.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(t.id)}
          >
            {t.label}
            {t.badge ? (
              <span className={`app-tab__badge${t.alert ? " is-alert" : ""}`}>{t.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Tab panel that stays mounted (keeps drafts and the 3D scene alive) but hidden when inactive. */
export function TabPanel(props: {
  id: AppTabId;
  active: AppTabId;
  className?: string;
  children: React.ReactNode;
}) {
  const { id, active, className, children } = props;
  return (
    <section
      id={panelId(id)}
      role="tabpanel"
      aria-labelledby={tabId(id)}
      className={className}
      hidden={id !== active}
    >
      {children}
    </section>
  );
}
