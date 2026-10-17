import { useMemo, useState } from 'react';
import { formatDuration, formatPercent } from '../format';
import type { FlameNode } from '../types';

const ROW_H = 20;

export interface FlameFilter {
  /** Fold Node's own frames (`node:` / `internal/`) into their callers. */
  hideInternals?: boolean;
  /** Fold `node_modules` frames into their callers. */
  hideDependencies?: boolean;
}

const isInternal = (n: FlameNode): boolean => /^(node:|internal\/)/.test(n.file);
const isDependency = (n: FlameNode): boolean => n.file.startsWith('node_modules/');

/**
 * Removes frames matching the filter by replacing each with its children and
 * adding its self time to the nearest kept caller, so totals are preserved.
 */
export function filterFlame(root: FlameNode, filter: FlameFilter): FlameNode {
  if (!filter.hideInternals && !filter.hideDependencies) return root;
  const hidden = (n: FlameNode): boolean =>
    (filter.hideInternals === true && isInternal(n)) ||
    (filter.hideDependencies === true && isDependency(n));
  const walk = (node: FlameNode): FlameNode => {
    let selfMs = node.selfMs;
    const children: FlameNode[] = [];
    const absorb = (child: FlameNode): void => {
      if (hidden(child)) {
        selfMs += child.selfMs;
        child.children.forEach(absorb);
      } else {
        children.push(walk(child));
      }
    };
    node.children.forEach(absorb);
    return { ...node, selfMs, children };
  };
  return walk(root);
}

function containsNode(root: FlameNode, target: FlameNode): boolean {
  if (root === target) return true;
  return root.children.some((c) => containsNode(c, target));
}
const MIN_FRACTION = 0.003;

interface Cell {
  node: FlameNode;
  depth: number;
  x0: number;
  x1: number;
  path: string;
}

/** Lays the tree out as rows (root on top); widths are fractions of the focused root. */
export function layoutFlame(root: FlameNode, focusTotal = root.totalMs): Cell[] {
  const out: Cell[] = [];
  const total = focusTotal > 0 ? focusTotal : 1;
  const walk = (node: FlameNode, depth: number, x0: number, path: string): void => {
    const width = node.totalMs / total;
    if (width < MIN_FRACTION) return;
    out.push({ node, depth, x0, x1: x0 + width, path });
    let cursor = x0;
    node.children.forEach((child, i) => {
      walk(child, depth + 1, cursor, `${path}/${i}`);
      cursor += child.totalMs / total;
    });
  };
  walk(root, 0, 0, '0');
  return out;
}

function hue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

function colorOf(node: FlameNode): string {
  if (node.name === '(idle)') return 'hsl(220 8% 62%)';
  if (node.name === '(garbage collector)') return 'hsl(0 65% 52%)';
  if (node.name === '(program)' || node.name === '(root)') return 'hsl(220 10% 50%)';
  if (node.file.startsWith('node_modules/')) return `hsl(${hue(node.file)} 35% 52%)`;
  return `hsl(${20 + (hue(node.name + node.file) % 40)} 80% 52%)`;
}

/**
 * Icicle-style flame graph. Width is time (including callees); click a frame to
 * zoom into it, and use the breadcrumb to zoom back out.
 */
export function FlameGraph({
  root: fullRoot,
  format = formatDuration,
  filter,
}: {
  root: FlameNode;
  /** Formats a node value (time by default; pass a byte formatter for heap profiles). */
  format?: (v: number) => string;
  filter?: FlameFilter;
}) {
  const [stack, setStack] = useState<FlameNode[]>([]);
  const hideInternals = filter?.hideInternals;
  const hideDependencies = filter?.hideDependencies;
  const root = useMemo(
    () => filterFlame(fullRoot, { hideInternals, hideDependencies }),
    [fullRoot, hideInternals, hideDependencies],
  );
  // A zoom path from before a filter change may point at removed nodes.
  const focus = useMemo(() => {
    const last = stack[stack.length - 1];
    return last && containsNode(root, last) ? last : root;
  }, [stack, root]);
  const cells = useMemo(() => layoutFlame(focus), [focus]);
  const depth = cells.reduce((m, c) => Math.max(m, c.depth), 0) + 1;

  return (
    <div className="flame">
      <div className="flame-crumbs">
        <button
          type="button"
          className="btn btn-sm"
          disabled={stack.length === 0}
          onClick={() => setStack([])}
        >
          Reset zoom
        </button>
        <span className="muted-text">
          {stack.length === 0
            ? 'Click a frame to zoom in.'
            : `Zoomed into ${focus.name} (${format(focus.totalMs)})`}
        </span>
      </div>
      <div
        className="flame-plot"
        role="img"
        aria-label={`Flame graph, ${cells.length} frames`}
        style={{ height: depth * ROW_H }}
      >
        {cells.map((c) => {
          const w = (c.x1 - c.x0) * 100;
          return (
            <button
              key={c.path}
              type="button"
              className="flame-cell"
              style={{
                left: `${c.x0 * 100}%`,
                width: `${w}%`,
                top: c.depth * ROW_H,
                height: ROW_H - 1,
                background: colorOf(c.node),
              }}
              title={`${c.node.name}${c.node.file ? `\n${c.node.file}:${c.node.line}` : ''}\n${format(c.node.totalMs)} total (${formatPercent(
                (c.x1 - c.x0) * (focus.totalMs / (root.totalMs || 1)),
              )} of profile), ${format(c.node.selfMs)} self`}
              onClick={() => {
                if (c.node.children.length > 0 && c.node !== focus) {
                  setStack((s) => [...s, c.node]);
                }
              }}
            >
              {w > 4 ? c.node.name : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}
