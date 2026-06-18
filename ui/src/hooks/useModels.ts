import { useState, useEffect } from 'react';

interface ModelOption {
  id: string;
  label: string;
}

// Shown while the list loads and as a fallback if /api/models is unreachable.
// "default" means "let the orchestrator/SDK pick its default model".
const FALLBACK_MODELS: Record<string, string> = {
  default: 'Default model',
};

/**
 * Loads the available Claude models from the server (`/api/models`), which
 * serves a curated current list — or the live Anthropic list when an API key
 * is configured. Returns a value→label map ready for the model <Select>, always
 * led by the "default" option.
 */
export function useModels(): Record<string, string> {
  const [models, setModels] = useState<Record<string, string>>(FALLBACK_MODELS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/models');
        if (!res.ok) return;
        const data = (await res.json()) as { models: ModelOption[] };
        if (cancelled || !data.models?.length) return;
        const map: Record<string, string> = { default: 'Default model' };
        for (const m of data.models) map[m.id] = m.label;
        setModels(map);
      } catch {
        // keep fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return models;
}
