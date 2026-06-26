export interface TreeCheckableNodeDef {
  /** Stable id used as a React key and the row's value. */
  id: string;
  /** Visible label of the node. */
  label: string;
  /** Child nodes, if any. Leaf nodes omit this. */
  children?: TreeCheckableNodeDef[];
}

export interface TreeCheckableExampleProps {
  /** Accessible name of the tree. */
  label: string;
  /** Root-level nodes. */
  nodes: TreeCheckableNodeDef[];
  /** Leaf ids that start checked. */
  defaultCheckedIds?: string[];
  /** Ids of nodes that start expanded. */
  defaultExpandedIds?: string[];
}
