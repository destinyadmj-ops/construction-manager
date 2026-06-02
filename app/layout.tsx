import type { Metadata, Viewport } from "next";
import { Suspense } from 'react';
import "./globals.css";
import LiveBuildSync from './live-build-sync';
import ServiceWorkerRegister from "./sw-register";
import AppHeader from "./header";
import { HeaderActionsProvider } from './header-actions';
import PwaBackGuard from './pwa-back-guard';
import UserGate from './user-gate';
import ColorEditOverlay from './color-edit-overlay';
import ColorEditController from './color-edit-controller';
import UiThemeLoader from './ui-theme-loader';
import PageThemeLoader from './page-theme-loader';

export const metadata: Metadata = {
  title: "Master Hub",
  description: "Calendar-based work hub (PC + mobile/PWA)",
  manifest: "/manifest.webmanifest",
  applicationName: "Master Hub",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Master Hub",
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: "#ffffff",
  colorScheme: 'light',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="mh-grid-strong mh-border-strong">
      <body className="antialiased" data-color-edit-slot="surface">
        <Suspense fallback={null}>
          <HeaderActionsProvider>
            <ServiceWorkerRegister />
            <LiveBuildSync />
            <PwaBackGuard />
            <UiThemeLoader />
            <PageThemeLoader />
            <AppHeader />
            <ColorEditOverlay />
            <ColorEditController />
            <UserGate>{children}</UserGate>
          </HeaderActionsProvider>
        </Suspense>
      </body>
    </html>
  );
}
