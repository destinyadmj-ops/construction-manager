'use client';

import { useEffect, useRef } from 'react';

const LIVE_BUILD_SYNC_INTERVAL_MS = 60_000;

type VersionInfo = {
  buildTime?: string;
  gitSha?: string | null;
};

function isElectronRuntime() {
  if (typeof navigator === 'undefined') return false;
  return /\bElectron\//.test(navigator.userAgent);
}

function perfLog(label: string, startedAt: number) {
  const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
  console.info(`[perf][live-build-sync] ${label}: ${elapsed}ms`);
}

function normalizeBuildMarker(info: VersionInfo | null) {
  if (!info) return null;
  const buildTime = typeof info.buildTime === 'string' ? info.buildTime.trim() : '';
  const gitSha = typeof info.gitSha === 'string' ? info.gitSha.trim() : '';
  if (!buildTime && !gitSha) return null;
  return `${buildTime}::${gitSha}`;
}

async function fetchVersionInfo() {
  try {
    const response = await fetch('/api/version', { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; info?: VersionInfo | null }
      | null;
    if (!payload || payload.ok !== true) return null;
    return payload.info ?? null;
  } catch {
    return null;
  }
}

async function clearRuntimeCaches() {
  const startedAt = performance.now();
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
  }

  if ('caches' in window) {
    const keys = await window.caches.keys().catch(() => [] as string[]);
    await Promise.all(keys.filter((key) => key.startsWith('master-hub-')).map((key) => window.caches.delete(key)));
  }

  perfLog('clearRuntimeCaches', startedAt);
}

function hasInteractiveFocus() {
  const activeElement = document.activeElement;
  if (!activeElement) return false;
  if (activeElement instanceof HTMLInputElement) return true;
  if (activeElement instanceof HTMLTextAreaElement) return true;
  if (activeElement instanceof HTMLSelectElement) return true;
  return activeElement instanceof HTMLElement && activeElement.isContentEditable;
}

function buildReloadUrl() {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('__liveBuild', String(Date.now()));
  return nextUrl.toString();
}

export default function LiveBuildSync() {
  const currentMarkerRef = useRef<string | null>(null);
  const pendingMarkerRef = useRef<string | null>(null);
  const requestInFlightRef = useRef(false);
  const reloadInFlightRef = useRef(false);

  useEffect(() => {
    if (!isElectronRuntime()) return;

    let disposed = false;

    const reloadToLatestBuild = async (marker: string) => {
      if (reloadInFlightRef.current) return;
      const reloadStartedAt = performance.now();
      reloadInFlightRef.current = true;
      currentMarkerRef.current = marker;
      pendingMarkerRef.current = null;

      await clearRuntimeCaches().catch(() => {
        // no-op
      });

      if (disposed) return;
      perfLog('reloadToLatestBuild -> location.replace', reloadStartedAt);
      window.location.replace(buildReloadUrl());
    };

    const checkLatestBuild = async ({
      allowReload,
      source,
    }: {
      allowReload: boolean;
      source: 'init' | 'interval' | 'focus' | 'visibility';
    }) => {
      if (requestInFlightRef.current || disposed) return;
      const checkStartedAt = performance.now();
      requestInFlightRef.current = true;

      try {
        const nextInfo = await fetchVersionInfo();
        const nextMarker = normalizeBuildMarker(nextInfo);
        if (!nextMarker) return;

        if (!currentMarkerRef.current) {
          currentMarkerRef.current = nextMarker;
          perfLog(`initial marker captured (${source})`, checkStartedAt);
          return;
        }

        if (nextMarker === currentMarkerRef.current) {
          pendingMarkerRef.current = null;
          return;
        }

        pendingMarkerRef.current = nextMarker;
        perfLog(`marker changed (${source}, allowReload=${allowReload ? '1' : '0'})`, checkStartedAt);

        if (!allowReload || hasInteractiveFocus()) return;
        await reloadToLatestBuild(nextMarker);
      } finally {
        requestInFlightRef.current = false;
      }
    };

    const flushPendingReload = () => {
      const pendingMarker = pendingMarkerRef.current;
      if (!pendingMarker || hasInteractiveFocus()) return;
      void reloadToLatestBuild(pendingMarker);
    };

    void checkLatestBuild({ allowReload: false, source: 'init' });

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void checkLatestBuild({ allowReload: true, source: 'interval' });
    }, LIVE_BUILD_SYNC_INTERVAL_MS);

    const handleFocus = () => {
      flushPendingReload();
      void checkLatestBuild({ allowReload: true, source: 'focus' });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      flushPendingReload();
      void checkLatestBuild({ allowReload: true, source: 'visibility' });
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return null;
}