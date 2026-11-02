import { Platform } from 'react-native';

/**
 * Home-screen icon for the web version: iPhone/iPad use apple-touch-icon
 * ("Add to Home Screen"), Android the web app manifest. The files are in
 * public/ and served from the site root.
 */
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('cp-touch-icon')) {
  const add = (tag: 'link' | 'meta', attrs: Record<string, string>) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.head.appendChild(el);
  };
  add('link', { id: 'cp-touch-icon', rel: 'apple-touch-icon', href: '/apple-touch-icon.png' });
  add('link', { rel: 'manifest', href: '/manifest.webmanifest' });
  add('meta', { name: 'apple-mobile-web-app-title', content: 'Call Planner' });
  add('meta', { name: 'theme-color', content: '#90021e' });
}
