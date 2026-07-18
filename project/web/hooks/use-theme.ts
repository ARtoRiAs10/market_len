"use client";
import { useEffect, useState } from "react";

type Theme = "dark" | "light";

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const stored = localStorage.getItem("ml-theme") as Theme | null;
    const initial: Theme = stored ?? "dark";
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  function setTheme(t: Theme) {
    setThemeState(t);
    localStorage.setItem("ml-theme", t);
    applyTheme(t);
  }

  return [theme, setTheme];
}

function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.remove("dark");
    root.classList.add("light");
  }
}
