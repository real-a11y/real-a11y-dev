export interface TreeNodeDef {
  /** Stable id used as a React key and the tree item's value. */
  id: string;
  /** Visible label of the node. */
  label: string;
  /** Child nodes, if any. Leaf nodes omit this. */
  children?: TreeNodeDef[];
}

export interface TreeViewExampleProps {
  /** Accessible name of the tree. */
  label: string;
  /** Root-level nodes. */
  nodes: TreeNodeDef[];
  /** Ids of nodes that start expanded. */
  defaultExpandedIds?: string[];
}
