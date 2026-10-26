// Ce que l'admin dit après avoir sollicité les contrôles automatiques : toujours ce qui s'est VRAIMENT passé. Un bouton qui
// répond « c'est parti » alors qu'aucune tâche n'existe est pire qu'une erreur : on croit que ça tourne.

export interface TrackScanResult {
  queued: boolean;
  reason?: string;
}

export function trackScanMessage(result: TrackScanResult): string {
  if (result.queued) return "Checks started. They take a few seconds to a minute: reload the page to see the result.";
  return "Checks are already waiting or running for this track. Reload the page in a moment.";
}

export interface RunPendingResult {
  started: boolean;
  waiting: number;
}

export function runPendingMessage(result: RunPendingResult): string {
  if (result.waiting <= 0) {
    return "Nothing was waiting in the queue, so nothing started. A track that was never queued is not picked up here: use “Check every track in review”, or open the track and press “Run the checks”.";
  }
  return `Resumed: ${result.waiting} track${result.waiting === 1 ? " is" : "s are"} waiting for a check. Reload the page in a moment.`;
}

export interface QueueReviewResult {
  in_review: number;
  queued: number;
  already_open: number;
}

export function queueReviewMessage(result: QueueReviewResult): string {
  if (result.in_review === 0) return "No track is waiting for review: nothing to check.";
  if (result.queued === 0) {
    return `All ${result.in_review} track${result.in_review === 1 ? "" : "s"} in review already have a check waiting or running. Reload the page in a moment.`;
  }
  const already = result.already_open > 0 ? `, ${result.already_open} already had one` : "";
  return `${result.queued} track${result.queued === 1 ? "" : "s"} queued for checks${already}. Reload the page in a minute to see the results.`;
}
