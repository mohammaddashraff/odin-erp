"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useERP } from "../core/erp-context";
import { Button } from "./ui";

type Theme = "dark" | "light";

const storageKey = "odin-theme";
const themeColors: Record<Theme, string> = {
  dark: "#030c1d",
  light: "#edf3fb",
};

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themeColors[theme]);
}

export default function ThemeToggle() {
  const { tr } = useERP();
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const sync = () => {
      const next = currentTheme();
      applyTheme(next);
      setTheme(next);
    };
    sync();
    const stored = (event: StorageEvent) => {
      if (event.key === storageKey) {
        const next = event.newValue === "light" ? "light" : "dark";
        applyTheme(next);
        setTheme(next);
      }
    };
    window.addEventListener("odin:theme-change", sync);
    window.addEventListener("storage", stored);
    return () => {
      window.removeEventListener("odin:theme-change", sync);
      window.removeEventListener("storage", stored);
    };
  }, []);
  const label =
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <Button
      className="theme-toggle"
      data-testid="theme-toggle"
      title={tr(label)}
      aria-label={tr(label)}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        applyTheme(next);
        setTheme(next);
        try {
          localStorage.setItem(storageKey, next);
        } catch {
          /* The control still works when browser storage is disabled. */
        }
        window.dispatchEvent(new Event("odin:theme-change"));
      }}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      <span>{tr(label)}</span>
    </Button>
  );
}
