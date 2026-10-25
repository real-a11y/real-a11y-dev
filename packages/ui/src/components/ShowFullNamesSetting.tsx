interface ShowFullNamesSettingProps {
  /** Whether the tree shows names in full. */
  checked: boolean;
  /** Called when the switch is turned on or off. */
  onChange: (showFullNames: boolean) => void;
  /** The id of the line that explains it, unique in its document. */
  hintId: string;
}

/**
 * The "Show full names" switch and the line that explains it, in a Settings
 * popup (`.sn-settings-menu`): the shared panel's, and the extension's.
 */
export function ShowFullNamesSetting({
  checked,
  onChange,
  hintId,
}: ShowFullNamesSettingProps) {
  return (
    <>
      <label class="sn-settings-item">
        <input
          type="checkbox"
          checked={checked}
          aria-describedby={hintId}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        />
        <span>Show full names</span>
      </label>
      <p id={hintId} class="sn-settings-hint">
        Rows widen to fit a long name, and the tree scrolls sideways. Off, the
        name ends in “…”: hover it to read the rest.
      </p>
    </>
  );
}
