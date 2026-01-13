import type { CapacitorConfig } from '@capacitor/cli';

// NOTE:
// This is a minimal wrapper that loads Master Hub from a server URL.
// For iOS App Store review, HTTPS is strongly recommended.

const config: CapacitorConfig = {
  appId: 'com.example.masterhub',
  appName: 'Master Hub',
  webDir: 'www',
  bundledWebRuntime: false,
  server: {
    // Set to your production URL (e.g. https://<device>.<tailnet>.ts.net/)
    url: 'https://YOUR_URL/',
    cleartext: false,
  },
  // allowNavigation can be used when your app navigates across subdomains.
  // allowNavigation: ['YOUR_DOMAIN'],
};

export default config;
