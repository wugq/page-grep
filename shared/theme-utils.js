// Returns true if the effective theme is dark.
// Loaded before any script that needs to evaluate the current theme.
function isThemeDark(theme) {
  return theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
