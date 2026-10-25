import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PENDING_MAX_AGE_MS, summarizeScans, type ScanJobRow, type ScanResultRow } from "./scanSummary.ts";

const T0 = Date.parse("2026-10-26T10:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

const job = (status: string, minutes = 0): ScanJobRow => ({ track_id: "t1", status, created_at: at(minutes) });
const scan = (check_kind: string, result: string, overrides: Partial<ScanResultRow> = {}): ScanResultRow => ({
  track_id: "t1",
  check_kind,
  result,
  decision: null,
  created_at: at(1),
  detail: {},
  ...overrides,
});

describe("summarizeScans : où en sont les contrôles", () => {
  it("aucune tâche : jamais lancés", () => {
    assert.equal(summarizeScans([], [], T0).state, "none");
  });

  it("une tâche en file ou en cours : en attente", () => {
    assert.equal(summarizeScans([job("queued")], [], T0 + 60_000).state, "pending");
    assert.equal(summarizeScans([job("running")], [], T0 + 60_000).state, "pending");
  });

  it("une tâche qui traîne depuis plus de 30 minutes ne bloque plus : indisponible", () => {
    assert.equal(summarizeScans([job("queued")], [], T0 + PENDING_MAX_AGE_MS + 1).state, "unavailable");
  });

  it("une tâche échouée : indisponible", () => {
    assert.equal(summarizeScans([job("failed")], [], T0 + 60_000).state, "unavailable");
  });

  it("seule la dernière tâche compte", () => {
    const jobs = [job("failed", 0), job("done", 10)];
    assert.equal(summarizeScans(jobs, [scan("similar_title", "ok", { created_at: at(11) })], T0 + 20 * 60_000).state, "done");
    assert.equal(summarizeScans([job("done", 0), job("queued", 10)], [], T0 + 11 * 60_000).state, "pending");
  });
});

describe("summarizeScans : ce que les contrôles ont trouvé", () => {
  const done = [job("done")];

  it("rien à signaler : le nombre de contrôles, aucune alerte", () => {
    const summary = summarizeScans(done, [scan("duplicate_audio", "ok"), scan("similar_title", "ok")], T0);
    assert.deepEqual(summary, { state: "done", failing: 0, confirmed: 0, warning: 0, unavailable: 0, checks: 2 });
  });

  it("un fail non tranché est grave ; écarté, il ne l'est plus", () => {
    assert.equal(summarizeScans(done, [scan("duplicate_audio", "fail")], T0).failing, 1);
    assert.equal(summarizeScans(done, [scan("duplicate_audio", "fail", { decision: "dismissed" })], T0).failing, 0);
  });

  it("un problème confirmé reste bloquant, même si le résultat n'était qu'un avertissement", () => {
    const summary = summarizeScans(done, [scan("similar_title", "warn", { decision: "confirmed" })], T0);
    assert.equal(summary.failing, 1);
    assert.equal(summary.confirmed, 1);
  });

  it("un warn non tranché est à regarder ; tranché, il disparaît", () => {
    assert.equal(summarizeScans(done, [scan("similar_title", "warn")], T0).warning, 1);
    assert.equal(summarizeScans(done, [scan("similar_title", "warn", { decision: "dismissed" })], T0).warning, 0);
  });

  it("un contrôle qui n'a pas pu répondre est compté à part, pas comme un avertissement", () => {
    const summary = summarizeScans(done, [scan("fingerprint", "warn", { detail: { unavailable: true } })], T0);
    assert.equal(summary.unavailable, 1);
    assert.equal(summary.warning, 0);
  });

  it("les refus faits à l'envoi du fichier ou du nom ne pèsent pas sur la publication", () => {
    const summary = summarizeScans(
      done,
      [scan("file_hash", "fail"), scan("blocked_file", "fail"), scan("name_similarity", "warn")],
      T0
    );
    assert.deepEqual(summary, { state: "done", failing: 0, confirmed: 0, warning: 0, unavailable: 0, checks: 0 });
  });

  it("les résultats d'une tâche précédente ne comptent plus (le fichier a pu être remplacé)", () => {
    const jobs = [job("done", 0), job("done", 30)];
    const old = scan("duplicate_audio", "fail", { created_at: at(1) });
    const fresh = scan("duplicate_audio", "ok", { created_at: at(31) });
    assert.equal(summarizeScans(jobs, [old, fresh], T0 + 40 * 60_000).failing, 0);
    assert.equal(summarizeScans(jobs, [old], T0 + 40 * 60_000).failing, 0);
  });

  it("un résultat écrit deux fois par une tâche reprise ne compte qu'une fois (le plus récent)", () => {
    const first = scan("duplicate_audio", "fail", { created_at: at(1) });
    const second = scan("duplicate_audio", "ok", { created_at: at(2) });
    const summary = summarizeScans(done, [first, second], T0);
    assert.equal(summary.checks, 1);
    assert.equal(summary.failing, 0);
  });
});
