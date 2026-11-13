import { setTheme, THEME_CHOICES, useThemeChoice, type ThemeChoice } from "./theme";
import "./themeSwitch.css";

const LABELS: Record<ThemeChoice, string> = { light: "Light", dark: "Dark", system: "System" };

/** Light / Dark / System as a radio group. Arrow keys move between choices, as for any radios. */
export function ThemeSwitch() {
  const choice = useThemeChoice();
  return (
    <fieldset className="sm-theme">
      <legend className="sm-visually-hidden">Theme</legend>
      {THEME_CHOICES.map((value) => (
        <label key={value} className="sm-theme__option">
          <input
            type="radio"
            name="sm-theme"
            value={value}
            checked={choice === value}
            onChange={() => {
              setTheme(value);
            }}
          />
          <span>{LABELS[value]}</span>
        </label>
      ))}
    </fieldset>
  );
}
