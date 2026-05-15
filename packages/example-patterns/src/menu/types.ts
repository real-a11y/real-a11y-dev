export interface MenuItemDef {
  /** Stable id used as a React key. */
  id: string;
  /** Visible label of the menu item. */
  label: string;
}

export interface MenuExampleProps {
  /** Visible label of the menu trigger button. */
  trigger: string;
  /** Menu items rendered as `menuitem`s. */
  items: MenuItemDef[];
}
