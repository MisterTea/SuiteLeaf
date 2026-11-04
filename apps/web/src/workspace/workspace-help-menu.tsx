import { Menu, MenuItem } from "../ui";
import { useCommandPalette } from "../command-palette";

export function EditorHelp() {
  const { openSearch, openShortcuts } = useCommandPalette();
  return (
    <Menu label="Help">
      <MenuItem onSelect={openSearch}>Search the menus</MenuItem>
      <MenuItem shortcut="Mod+/" onSelect={openShortcuts}>
        Keyboard shortcuts
      </MenuItem>
    </Menu>
  );
}
