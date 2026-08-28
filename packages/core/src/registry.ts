import type { NodeUIProvider, PanelId } from './types';

/** Ordered registry of the standard panel providers. */
export class ProviderRegistry {
  private providers = new Map<PanelId, NodeUIProvider>();

  register(provider: NodeUIProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: PanelId): NodeUIProvider | undefined {
    return this.providers.get(id);
  }

  ids(): PanelId[] {
    return [...this.providers.keys()];
  }

  all(): NodeUIProvider[] {
    return [...this.providers.values()];
  }
}
