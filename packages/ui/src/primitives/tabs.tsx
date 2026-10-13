import * as React from 'react';

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly count?: number;
  readonly icon?: React.ReactNode;
}

export interface TabsProps {
  readonly tabs: readonly TabItem[];
  readonly activeTabId: string;
  readonly onTabChange: (tabId: string) => void;
  readonly ariaLabel?: string;
  readonly className?: string;
}

export function Tabs({
  tabs,
  activeTabId,
  onTabChange,
  ariaLabel = 'Pestañas de navegación',
  className,
}: TabsProps): React.JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex items-center gap-2 border-b-2 border-border overflow-x-auto select-none p-1 bg-surface-raised rounded-t-lg ${
        className ?? ''
      }`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            className={`min-h-[48px] px-5 py-2.5 flex items-center gap-2.5 text-md font-semibold rounded-md transition-all focus:outline-none focus:ring-2 focus:ring-focus ${
              isActive
                ? 'bg-surface text-brand shadow-1 border-2 border-brand'
                : 'text-text-muted hover:text-text hover:bg-surface/50 border-2 border-transparent'
            }`}
          >
            {tab.icon ? <span className="w-5 h-5">{tab.icon}</span> : null}
            <span>{tab.label}</span>
            {tab.count !== undefined ? (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-bold [font-variant-numeric:tabular-nums] ${
                  isActive
                    ? 'bg-brand-soft text-brand-strong'
                    : 'bg-surface-raised text-text-muted'
                }`}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
