import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "./sw-register";
import AppHeader from "./header";
import { HeaderActionsProvider } from './header-actions';
import PwaBackGuard from './pwa-back-guard';

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
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">
        <HeaderActionsProvider>
          <ServiceWorkerRegister />
          <PwaBackGuard />
          <AppHeader />
          {children}
        </HeaderActionsProvider>
      </body>
    </html>
  );
}
