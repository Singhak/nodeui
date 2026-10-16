import type { Annotation, AnnotationKind } from './types';

const MAX_ANNOTATIONS = 500;
const MAX_LABEL = 120;

/**
 * Time-stamped markers (deploys, notes, load-test boundaries, alerts) drawn on
 * the metrics charts, so a spike can be matched to what happened around it.
 */
export class AnnotationStore {
  private readonly items: Annotation[] = [];
  private nextId = 1;
  onAdd?: (a: Annotation) => void;

  constructor(private readonly now: () => number = Date.now) {}

  add(label: string, kind: AnnotationKind = 'note', atMs: number = this.now()): Annotation {
    const clean = String(label)
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, MAX_LABEL);
    if (!clean) throw new Error('label must not be empty');
    const item: Annotation = { id: this.nextId, atMs, label: clean, kind };
    this.nextId += 1;
    this.items.push(item);
    if (this.items.length > MAX_ANNOTATIONS)
      this.items.splice(0, this.items.length - MAX_ANNOTATIONS);
    this.onAdd?.(item);
    return item;
  }

  /** Annotations inside `[fromMs, toMs]`, oldest first. */
  range(fromMs: number, toMs: number): Annotation[] {
    return this.items.filter((a) => a.atMs >= fromMs && a.atMs <= toMs);
  }

  remove(id: number): boolean {
    const i = this.items.findIndex((a) => a.id === id && a.kind === 'note');
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }
}
