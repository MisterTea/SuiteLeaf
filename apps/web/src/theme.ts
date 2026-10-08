import { useEffect, useState, useSyncExternalStore } from "react";

export type ThemeMode = "system" | "dark" | "light";

const STORAGE_KEY = "suiteleaf_theme_mode";

function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getStoredThemeMode(): ThemeMode {
  if (typeof localStorage === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light" || stored === "system") {
    return stored;
  }
  return "system";
}

let currentThemeMode: ThemeMode = getStoredThemeMode();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function setThemeMode(mode: ThemeMode) {
  if (currentThemeMode === mode) return;
  currentThemeMode = mode;
  try {
    if (mode === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  } catch {
    // ignore localStorage failures
  }
  updateDomTheme();
  notify();
}

export function getThemeMode(): ThemeMode {
  return currentThemeMode;
}

export function getEffectiveTheme(mode: ThemeMode = currentThemeMode): "dark" | "light" {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return getSystemPrefersDark() ? "dark" : "light";
}

export function updateDomTheme() {
  if (typeof document === "undefined") return;
  const effective = getEffectiveTheme(currentThemeMode);
  const root = document.documentElement;

  root.dataset.theme = effective;
  root.dataset.themeMode = currentThemeMode;

  if (effective === "dark") {
    root.classList.add("dark-theme", "univer-dark");
    root.classList.remove("light-theme");
  } else {
    root.classList.add("light-theme");
    root.classList.remove("dark-theme", "univer-dark");
  }
}

// Subscribe to OS color scheme changes
if (typeof window !== "undefined" && window.matchMedia) {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSystemChange = () => {
    updateDomTheme();
    notify();
  };
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handleSystemChange);
  } else if (typeof mediaQuery.addListener === "function") {
    mediaQuery.addListener(handleSystemChange);
  }
  // Initialize DOM immediately
  updateDomTheme();
}

export function useTheme() {
  const mode = useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    () => currentThemeMode,
    () => "system",
  );

  const [systemDark, setSystemDark] = useState(getSystemPrefersDark);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemDark(e.matches);
    };
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handler);
      return () => mediaQuery.removeListener(handler);
    }
  }, []);

  const isDark = mode === "dark" || (mode === "system" && systemDark);

  return {
    mode,
    isDark,
    setThemeMode,
    toggleTheme: () => {
      // Cycle: system -> dark -> light -> system
      if (mode === "system") setThemeMode("dark");
      else if (mode === "dark") setThemeMode("light");
      else setThemeMode("system");
    },
  };
}
