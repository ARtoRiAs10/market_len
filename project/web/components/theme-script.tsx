/**
 * Inline script injected in <head> to read localStorage and apply theme
 * BEFORE React hydrates. Prevents flash of wrong theme on page load.
 */
export function ThemeScript() {
  const script = `
    (function(){
      try {
        var t = localStorage.getItem('ml-theme') || 'dark';
        document.documentElement.classList.toggle('dark', t === 'dark');
        document.documentElement.classList.toggle('light', t === 'light');
      } catch(e) {
        document.documentElement.classList.add('dark');
      }
    })();
  `;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
