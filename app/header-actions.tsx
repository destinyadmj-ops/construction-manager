'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type HeaderAction = {
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  title?: string;
};

export type HeaderHistoryHover = { userId: string; day: string };

export type HeaderHistoryItem = {
  key: string;
  at: number;
  beforeLabel: string;
  afterLabel: string;
  editorLabel: string;
  hover: HeaderHistoryHover;
};

export type HeaderHistoryMenu = {
  items: HeaderHistoryItem[];
  onHover?: (hover: HeaderHistoryHover | null) => void;
};

type HeaderActionsState = {
  add?: HeaderAction;
  history?: HeaderAction;
  historyMenu?: HeaderHistoryMenu;
  save?: HeaderAction;
  undo?: HeaderAction;
  redo?: HeaderAction;
};

type HeaderActionsContextValue = {
  actions: HeaderActionsState;
  setAddAction: (action: HeaderAction | undefined) => void;
  setHistoryAction: (action: HeaderAction | undefined) => void;
  setHistoryMenu: (menu: HeaderHistoryMenu | undefined) => void;
  setSaveAction: (action: HeaderAction | undefined) => void;
  setUndoAction: (action: HeaderAction | undefined) => void;
  setRedoAction: (action: HeaderAction | undefined) => void;
};

const HeaderActionsContext = createContext<HeaderActionsContextValue | null>(null);

export function HeaderActionsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams?.toString() ?? '';
  const [actions, setActions] = useState<HeaderActionsState>({});

  useEffect(() => {
    // This intentionally clears header actions on navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActions({});
  }, [pathname, searchKey]);

  const setAddAction = useCallback((action: HeaderAction | undefined) => {
    setActions((cur) => ({ ...cur, add: action }));
  }, []);

  const setHistoryAction = useCallback((action: HeaderAction | undefined) => {
    setActions((cur) => ({ ...cur, history: action }));
  }, []);

  const setHistoryMenu = useCallback((menu: HeaderHistoryMenu | undefined) => {
    setActions((cur) => ({ ...cur, historyMenu: menu }));
  }, []);

  const setSaveAction = useCallback((action: HeaderAction | undefined) => {
    setActions((cur) => ({ ...cur, save: action }));
  }, []);

  const setUndoAction = useCallback((action: HeaderAction | undefined) => {
    setActions((cur) => ({ ...cur, undo: action }));
  }, []);

  const setRedoAction = useCallback((action: HeaderAction | undefined) => {
    setActions((cur) => ({ ...cur, redo: action }));
  }, []);

  const value = useMemo<HeaderActionsContextValue>(
    () => ({ actions, setAddAction, setHistoryAction, setHistoryMenu, setSaveAction, setUndoAction, setRedoAction }),
    [actions, setAddAction, setHistoryAction, setHistoryMenu, setRedoAction, setSaveAction, setUndoAction],
  );

  return <HeaderActionsContext.Provider value={value}>{children}</HeaderActionsContext.Provider>;
}

export function useHeaderActions() {
  const ctx = useContext(HeaderActionsContext);
  if (!ctx) throw new Error('useHeaderActions must be used within HeaderActionsProvider');
  return ctx;
}
