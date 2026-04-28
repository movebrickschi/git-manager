import type { GraphRow, GraphEdge } from "./commands";

const GRAPH_COLORS = [
  "var(--color-graph-0)",
  "var(--color-graph-1)",
  "var(--color-graph-2)",
  "var(--color-graph-3)",
  "var(--color-graph-4)",
  "var(--color-graph-5)",
  "var(--color-graph-6)",
  "var(--color-graph-7)",
];

export function getGraphColor(index: number): string {
  return GRAPH_COLORS[index % GRAPH_COLORS.length];
}

export interface GraphRenderData {
  width: number;
  nodeX: number;
  nodeY: number;
  color: string;
  lines: GraphLineData[];
}

export interface GraphLineData {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  curved: boolean;
}

const COL_WIDTH = 16;
const ROW_HEIGHT = 24;
const NODE_RADIUS = 3;
const PADDING = 8;

export function computeGraphRender(
  row: GraphRow,
  rowIndex: number,
  maxColumns: number
): GraphRenderData {
  const nodeX = PADDING + row.column * COL_WIDTH;
  const nodeY = ROW_HEIGHT / 2;
  const color = getGraphColor(row.color);

  const lines: GraphLineData[] = [];

  for (const edge of row.edges) {
    const x1 = PADDING + edge.fromCol * COL_WIDTH;
    const y1 = ROW_HEIGHT / 2;
    const x2 = PADDING + edge.toCol * COL_WIDTH;
    const y2 = ROW_HEIGHT + ROW_HEIGHT / 2;
    const edgeColor = getGraphColor(edge.color);

    lines.push({
      x1,
      y1,
      x2,
      y2,
      color: edgeColor,
      curved: edge.fromCol !== edge.toCol,
    });
  }

  const width = PADDING * 2 + Math.max(maxColumns, 1) * COL_WIDTH;

  return { width, nodeX, nodeY, color, lines };
}

export function getMaxColumns(graphRows: GraphRow[]): number {
  let max = 0;
  for (const row of graphRows) {
    max = Math.max(max, row.column + 1);
    for (const edge of row.edges) {
      max = Math.max(max, edge.fromCol + 1, edge.toCol + 1);
    }
  }
  return max;
}

export { COL_WIDTH, ROW_HEIGHT, NODE_RADIUS, PADDING };
