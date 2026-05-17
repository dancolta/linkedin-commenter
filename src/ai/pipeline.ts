import { draftBatch } from './drafter.js';
import { validateDraft } from './guardrails.js';

export type ItemVerdict =
  | { status: 'queued'; draft: string; attempts: number }
  | { status: 'skipped'; reason: string; lastDraft?: string };

export interface PipelineInput {
  author: string;
  postText: string;
}

export interface PipelineOptions {
  recentComments?: string[];
  logger?: (msg: string) => void;
}

/**
 * Drafter + regex guardrails. QC layer disabled (see qc.ts).
 * Re-enable by importing qcBatch and wrapping a retry loop around the guardrail
 * pass — pipeline.ts history shows the prior evaluator-optimizer shape.
 */
export async function runDraftPipeline(
  inputs: PipelineInput[],
  options: PipelineOptions = {},
): Promise<ItemVerdict[]> {
  if (inputs.length === 0) return [];
  const log = options.logger ?? (() => {});
  const recent = options.recentComments ?? [];

  log(`Drafting ${inputs.length} comment${inputs.length === 1 ? '' : 's'}...`);
  const drafts = await draftBatch(inputs.map(it => ({ author: it.author, text: it.postText })));

  const batchAccepted: string[] = [];
  return inputs.map((_, i) => {
    const raw = (drafts[i] ?? 'SKIP').trim();
    if (raw.toUpperCase() === 'SKIP') {
      return { status: 'skipped', reason: 'drafter returned SKIP' };
    }
    const guardrail = validateDraft(raw, recent, batchAccepted);
    if (!guardrail.ok) {
      return { status: 'skipped', reason: `guardrail: ${guardrail.reason}`, lastDraft: raw };
    }
    batchAccepted.push(raw);
    return { status: 'queued', draft: raw, attempts: 1 };
  });
}
