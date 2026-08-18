"use client";
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
type Theme = "light" | "dark";
const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
} | null>(null);
function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}
const themeEvent = "blinkroom:theme-change";
function currentTheme(): Theme { return document.documentElement.classList.contains("dark") ? "dark" : "light"; }
function subscribeTheme(change: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === "blinkroom-theme") { const next = event.newValue === "dark" ? "dark" : "light"; applyTheme(next); change(); } };
  window.addEventListener(themeEvent, change); window.addEventListener("storage", storage);
  return () => { window.removeEventListener(themeEvent, change); window.removeEventListener("storage", storage); };
}
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore<Theme>(subscribeTheme, currentTheme, () => "light");
  const setTheme = (next: Theme) => {
    applyTheme(next);
    localStorage.setItem("blinkroom-theme", next);
    window.dispatchEvent(new Event(themeEvent));
  };
  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    }),
    [theme],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
