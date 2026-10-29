"use client";

import { useEffect, useState } from "react";
import { Laptop, Moon, Sun } from "lucide-react";
import { useERP } from "../core/erp-context";
import { Button } from "./ui";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const storageKey = "odin-theme";
const themeColors: Record<ResolvedTheme, string> = {
  dark: "#0b1220",
  light: "#f5f7fb",
};

function validPreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

function resolvedTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyThemePreference(preference: ThemePreference) {
  const resolved = resolvedTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themeColors[resolved]);
  return resolved;
}

function storedPreference() {
  try {
    return validPreference(localStorage.getItem(storageKey));
  } catch {
    return "system" as const;
  }
}

function setStoredPreference(preference: ThemePreference) {
  try {
    localStorage.setItem(storageKey, preference);
  } catch {
    /* The preference still applies for this page when storage is unavailable. */
  }
  applyThemePreference(preference);
  window.dispatchEvent(
    new CustomEvent<ThemePreference>("odin:theme-change", {
      detail: preference,
    }),
  );
}

function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = (next = storedPreference()) => {
      setPreference(next);
      setResolved(applyThemePreference(next));
    };
    const systemChanged = () => {
      if (storedPreference() === "system") sync("system");
    };
    const themeChanged = (event: Event) =>
      sync((event as CustomEvent<ThemePreference>).detail || storedPreference());
    const storageChanged = (event: StorageEvent) => {
      if (event.key === storageKey) sync(validPreference(event.newValue));
    };

    sync();
    media.addEventListener("change", systemChanged);
    window.addEventListener("odin:theme-change", themeChanged);
    window.addEventListener("storage", storageChanged);
    return () => {
      media.removeEventListener("change", systemChanged);
      window.removeEventListener("odin:theme-change", themeChanged);
      window.removeEventListener("storage", storageChanged);
    };
  }, []);

  return { preference, resolved, setPreference: setStoredPreference };
}

export default function ThemeToggle({
  variant = "quick",
  compact = false,
}: {
  variant?: "quick" | "selector";
  compact?: boolean;
}) {
  const { tr } = useERP();
  const { preference, resolved, setPreference } = useThemePreference();

  if (variant === "selector") {
    const options: Array<{
      value: ThemePreference;
      label: string;
      icon: typeof Sun;
    }> = [
      { value: "light", label: "Light", icon: Sun },
      { value: "dark", label: "Dark", icon: Moon },
      { value: "system", label: "System", icon: Laptop },
    ];
    return (
      <div
        className="theme-selector"
        data-testid="theme-selector"
        role="group"
        aria-label={tr("Appearance")}
      >
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <Button
              key={option.value}
              className="theme-option"
              aria-pressed={preference === option.value}
              onClick={() => setPreference(option.value)}
            >
              <Icon size={16} />
              <span>{tr(option.label)}</span>
            </Button>
          );
        })}
      </div>
    );
  }

  const label =
    resolved === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <Button
      className={`theme-toggle ${compact ? "theme-toggle-compact" : ""}`}
      data-testid="theme-toggle"
      title={tr(label)}
      aria-label={tr(label)}
      onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}
    >
      {resolved === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      {compact ? null : <span>{tr(label)}</span>}
    </Button>
  );
}
