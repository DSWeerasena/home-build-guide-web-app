import { Moon, Sun } from "lucide-react";
import { useLanguage } from "../i18n";
import { useTheme } from "../theme/ThemeProvider";

// A single control that flips between the light and dark palettes; its label names the theme it switches to.
export default function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const { t } = useLanguage();
  const toLight = theme === "dark";
  const label = t(toLight ? "theme.switchToLight" : "theme.switchToDark");
  return <button
    type="button"
    className={"icon-btn theme-toggle " + (className || "")}
    onClick={toggle}
    aria-label={label}
    title={label}
    aria-pressed={!toLight}
  >
    {toLight ? <Sun size={18} /> : <Moon size={18} />}
  </button>;
}
