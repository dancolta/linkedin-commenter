import { draftBatch } from './drafter.js';
import { validateDraft } from './guardrails.js';

// Contrarian-marker phrases — used for batch-frequency monitoring only (logged, not rejected).
// Keep tight: only strong push-back signals. Common Dan idiom (`Yeah`, `Honestly`) is NOT here
// because most additive comments also start that way — we'd false-flag the bias.
const CONTRARIAN_MARKERS = [
  /\bi'd push back\b/i,
  /\bi'm not sure\b/i,
  /\bmy read is\b/i,
  /\bi read this differently\b/i,
  /\bi read it more as\b/i,
  /\bthough for me\b/i,
  /\bdepends what\b/i,
  /\bdepends on what\b/i,
  /\bhmm,? i'd\b/i,
  /\bwait,? does\b/i,
];
const CONTRARIAN_BATCH_CAP = 0.4; // log a warning if >40% of accepted batch is visibly contrarian

function isContrarian(draft: string): boolean {
  return CONTRARIAN_MARKERS.some(re => re.test(draft));
}

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
  const results = inputs.map((_, i) => {
    const raw = (drafts[i] ?? 'SKIP').trim();
    if (raw.toUpperCase() === 'SKIP') {
      return { status: 'skipped', reason: 'drafter returned SKIP' } as ItemVerdict;
    }
    const guardrail = validateDraft(raw, recent, batchAccepted);
    if (!guardrail.ok) {
      return { status: 'skipped', reason: `guardrail: ${guardrail.reason}`, lastDraft: raw } as ItemVerdict;
    }
    batchAccepted.push(raw);
    return { status: 'queued', draft: raw, attempts: 1 } as ItemVerdict;
  });

  // Batch-level monitor: warn if contrarian frame is drifting above the 40% cap.
  // Soft warning only — we don't reject. The model can't count siblings, so we surface
  // the drift to the operator instead of silently shipping a too-spicy batch.
  if (batchAccepted.length >= 4) {
    const contrarianCount = batchAccepted.filter(isContrarian).length;
    const ratio = contrarianCount / batchAccepted.length;
    if (ratio > CONTRARIAN_BATCH_CAP) {
      log(`⚠ Contrarian-frame drift: ${contrarianCount}/${batchAccepted.length} drafts (${Math.round(ratio * 100)}%) carry push-back markers. Target ≤40%. Review before publishing.`);
    }
  }

  return results;
}
