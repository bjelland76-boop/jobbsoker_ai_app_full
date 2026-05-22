import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.frankbjelland.aerligjobbcoach',
  appName: 'Ærlig JobbCoach',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    // IMPORTANT: for production builds you normally do NOT set this.
    // For local device testing you can temporarily set:
    // url: 'http://<your-lan-ip>:5173',
    // cleartext: true,
  },
};

export default config;
