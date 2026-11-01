import { Platform } from 'react-native';

/**
 * The web tab bar pads each tab generously, so on a phone-width screen the last
 * tab ends up off the edge. Tighten it on narrow screens (web only).
 */
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('cp-web-styles')) {
  const style = document.createElement('style');
  style.id = 'cp-web-styles';
  style.textContent = `
    @media (max-width: 520px) {
      [role="tablist"][aria-label="Main"] { max-width: calc(100vw - 16px); }
      [role="tablist"][aria-label="Main"] > [role="tab"] { padding: 0 12px; }
    }`;
  document.head.appendChild(style);
}
