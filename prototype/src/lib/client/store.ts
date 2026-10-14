"use client";

import { useCallback, useEffect, useState } from "react";
import type { Clause, Decision, ReviewResult, ReviewerAction, ReviewerActionKind } from "../types";
import type { Lifecycle } from "../labels";

/**
 * Demo persistence (BUILD_PLAN decision 3): reviewer actions, decisions, lifecycle status, uploads and
 * the audit trail live in this browser's localStorage. Every read/write is guarded — storage can be
 * unavailable (private mode) and the app must still work, just without persistence.
 */

// the signed-in user (set by UserProvider from the server session) — recorded on every action
let current: { username: string; name: string; role: "signer" | "stakeholder" } = { username: "unknown", name: "Unknown user", role: "stakeholder" };
export function setCurrentUser(u: { username: string; name: string; role: "signer" | "stakeholder" }) {
  current = u;
}
export function reviewerName(): string {
  return current.name;
}
const NS = "atliq.v1.";
const EVT = "atliq-store";

function read<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(NS + key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    // quota / private mode — the in-memory state still updates for this session
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: key }));
}

export function useStored<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void, boolean] {
  const [state, setState] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setState(read(key, fallback));
    setReady(true);
    const on = (e: Event) => {
      const k = (e as CustomEvent).detail;
      if (k === key) setState(read(key, fallback));
    };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        write(key, next);
        return next;
      });
    },
    [key],
  );
  return [state, set, ready];
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export interface AuditEvent {
  at: string;
  by: string;
  contract_id: string;
  review_id?: string;
  version?: number;
  kind: "finding_action" | "action_undone" | "decision" | "status_change" | "review_run" | "register_verified" | "report_exported";
  detail: string;
  finding_id?: string;
}

export function logAudit(e: Omit<AuditEvent, "at" | "by">) {
  const list = read<AuditEvent[]>("audit", []);
  list.push({ ...e, at: new Date().toISOString(), by: reviewerName() });
  write("audit", list.slice(-2000));
}

// ---------------------------------------------------------------------------
// Finding actions
// ---------------------------------------------------------------------------

export type ActionMap = Record<string, ReviewerAction>;

export function useFindingActions(reviewId: string, contractId: string, version: number) {
  const [actions, setActions] = useStored<ActionMap>(`actions.${reviewId}`, {});
  const record = (findingId: string, action: ReviewerActionKind, rationale: string, title: string) => {
    const a: ReviewerAction = { finding_id: findingId, action, rationale, by: reviewerName(), at: new Date().toISOString() };
    setActions((prev) => ({ ...prev, [findingId]: a }));
    logAudit({ contract_id: contractId, review_id: reviewId, version, kind: "finding_action", finding_id: findingId, detail: `${action.toUpperCase()} — "${title}"${rationale ? ` · rationale: ${rationale}` : ""}` });
  };
  const undo = (findingId: string, title: string) => {
    const prev = actions[findingId];
    setActions((p) => {
      const n = { ...p };
      delete n[findingId];
      return n;
    });
    logAudit({ contract_id: contractId, review_id: reviewId, version, kind: "action_undone", finding_id: findingId, detail: `Undid ${prev?.action ?? "action"} — "${title}" (kept in audit trail)` });
  };
  return { actions, record, undo };
}

// ---------------------------------------------------------------------------
// Decisions + lifecycle
// ---------------------------------------------------------------------------

export function useDecisions(contractId: string) {
  return useStored<Decision[]>(`decisions.${contractId}`, []);
}

export function useLifecycle(contractId: string, initial: Lifecycle) {
  const [status, setStatus, ready] = useStored<Lifecycle | null>(`status.${contractId}`, null);
  const change = (s: Lifecycle) => {
    setStatus(s);
    logAudit({ contract_id: contractId, kind: "status_change", detail: `Status set to ${s} (human action)` });
  };
  return [status ?? initial, change, ready] as const;
}

// ---------------------------------------------------------------------------
// Reviews produced in the browser session (uploads and re-runs)
// ---------------------------------------------------------------------------

export interface StoredReview {
  review: ReviewResult;
  clauses: Clause[];
  provenance: string | null;
  text: string;
}

export interface UploadEntry {
  id: string; // U-…
  file_name: string;
  title: string;
  counterparty: string;
  contract_type: string;
  atliq_entity: string;
  created: string;
  versions: { version: number; review_id: string; at: string; key: string }[];
}

export function saveReviewVersion(contractId: string, data: StoredReview, meta?: Omit<UploadEntry, "versions" | "id" | "created">) {
  const key = `review.${contractId}.v${data.review.version}`;
  write(key, data);
  const versions = read<UploadEntry["versions"]>(`versions.${contractId}`, []);
  versions.push({ version: data.review.version, review_id: data.review.review_id, at: data.review.generated_at, key });
  write(`versions.${contractId}`, versions);
  if (contractId.startsWith("U-") && meta) {
    const uploads = read<UploadEntry[]>("uploads", []);
    const existing = uploads.find((u) => u.id === contractId);
    if (existing) existing.versions = versions;
    else uploads.unshift({ ...meta, id: contractId, created: new Date().toISOString(), versions });
    write("uploads", uploads);
  }
  logAudit({ contract_id: contractId, review_id: data.review.review_id, version: data.review.version, kind: "review_run", detail: `Review v${data.review.version} run (${data.review.ai.status === "completed" ? "AI + rules" : "rules only — AI " + data.review.ai.status}); ${data.review.findings.length} findings` });
}

export function loadReviewVersion(key: string): StoredReview | null {
  return read<StoredReview | null>(key, null);
}

export function useVersions(contractId: string) {
  return useStored<UploadEntry["versions"]>(`versions.${contractId}`, []);
}

export function useUploads() {
  return useStored<UploadEntry[]>("uploads", []);
}

export function useAudit() {
  return useStored<AuditEvent[]>("audit", []);
}

export function useRegisterVerified() {
  return useStored<Record<string, { by: string; at: string }>>("register.verified", {});
}
