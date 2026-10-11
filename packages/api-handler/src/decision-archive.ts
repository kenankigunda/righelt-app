import { COMPUTER_LIMITS } from '../../shared-types/src/computer-play';
import { canonicalCommandJson, encodedSyncBytes } from '../../shared-types/src/sync-protocol';
import type { LiveGame, MoveEntry } from './shell-live-core';
import type { LiveGameEnv, D1Statement } from './shell-live-db';

export type ArchivedDecision = { id: string; kind: 'decision' | 'restoration' | 'turn' | 'initial'; revision: number; eventSeq: number; ordinal: number; at: string; move?: MoveEntry; restoredIds?: string[]; targetDecisionId?: string; state?: LiveGame['board']['state']; partial?: boolean };
const insert = (env: LiveGameEnv, gameId: string, entry: ArchivedDecision) => env.DB.prepare('INSERT INTO live_decision_archive (game_id, decision_id, event_seq, event_ordinal, gameplay_revision, payload_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(gameId, entry.id, entry.eventSeq, entry.ordinal, entry.revision, JSON.stringify(entry));

/** These statements join the same D1 batch as the projection and command receipt. */
export function archiveStatements(env: LiveGameEnv, before: LiveGame | null, game: LiveGame, eventSeq: number): D1Statement[] {
  const statements: D1Statement[] = [];
  const revision = game.gameplayRevision;
  const needsBackfill = before?.archiveStartRevision === undefined;
  let ordinal = 0;
  const append = (entry: Omit<ArchivedDecision, 'ordinal'>) => statements.push(insert(env, game.id, { ...entry, ordinal: ordinal++ }));
  if (needsBackfill) {
    game.archiveStartRevision = before?.gameplayRevision ?? 0;
    append({ id: 'initial', kind: 'initial', revision: game.archiveStartRevision, eventSeq, at: game.createdAt, state: before?.moves[0]?.selectionSnapshot ?? game.moves[0]?.selectionSnapshot ?? game.board.state, partial: Boolean(before) });
    for (const move of before?.moves ?? []) append({ id: move.moveId, kind: 'decision', revision: game.archiveStartRevision, eventSeq, at: move.at, move, partial: true });
  }
  const oldIds = new Set(before?.moves.map((move) => move.moveId) ?? []);
  const added = game.moves.filter((move) => !oldIds.has(move.moveId));
  for (const move of added) append({ id: move.moveId, kind: 'decision', revision, eventSeq, at: move.at, move });
  const restoredIds = game.moves.filter((move) => move.undone && before?.moves.some((old) => old.moveId === move.moveId && !old.undone)).map((move) => move.moveId);
  if (restoredIds.length || game.lastRestoration?.at !== before?.lastRestoration?.at) append({ id: `restore-${eventSeq}`, kind: 'restoration', revision, eventSeq, at: game.updatedAt, restoredIds, targetDecisionId: game.lastRestoration?.decisionId, state: game.board.state });
  else if (before && revision !== before.gameplayRevision && !added.length) append({ id: `turn-${eventSeq}`, kind: 'turn', revision, eventSeq, at: game.updatedAt, state: game.board.state });
  if (needsBackfill || (before && revision !== before.gameplayRevision && revision % COMPUTER_LIMITS.checkpointEvery === 0)) {
    statements.push(env.DB.prepare('INSERT INTO live_position_checkpoints (game_id, gameplay_revision, state_json) VALUES (?1, ?2, ?3)').bind(game.id, revision, JSON.stringify(game.board.state)));
  }
  return statements;
}
export async function readDecision(env: LiveGameEnv, gameId: string, decisionId: string): Promise<ArchivedDecision | null> {
  const row = await env.DB.prepare('SELECT payload_json FROM live_decision_archive WHERE game_id = ?1 AND decision_id = ?2').bind(gameId, decisionId).first<{ payload_json: string }>();
  return row ? JSON.parse(row.payload_json) : null;
}
export async function readDecisionPage(env: LiveGameEnv, gameId: string, cursor: unknown) {
  const parsed = cursor && typeof cursor === 'object' ? cursor as { eventSeq?: unknown; ordinal?: unknown } : { eventSeq: 0, ordinal: -1 };
  if (!Number.isSafeInteger(parsed.eventSeq) || Number(parsed.eventSeq) < 0 || !Number.isSafeInteger(parsed.ordinal) || Number(parsed.ordinal) < -1) throw new Error('invalid_history_cursor');
  const rows = await env.DB.prepare('SELECT payload_json FROM live_decision_archive WHERE game_id = ?1 AND (event_seq > ?2 OR (event_seq = ?2 AND event_ordinal > ?3)) ORDER BY event_seq, event_ordinal LIMIT ?4').bind(gameId, parsed.eventSeq, parsed.ordinal, COMPUTER_LIMITS.historyPage + 1).all<{ payload_json: string }>();
  const entries: ArchivedDecision[] = (rows.results ?? []).map((row) => JSON.parse(row.payload_json));
  const items = entries.slice(0, COMPUTER_LIMITS.historyPage);
  const last = items.at(-1);
  return { items, nextCursor: entries.length > items.length && last ? { eventSeq: last.eventSeq, ordinal: last.ordinal } : null };
}
export async function readDecisionNotes(env: LiveGameEnv, gameId: string, accountId: string) {
  const rows = await env.DB.prepare('SELECT decision_id, note_json FROM live_decision_notes WHERE game_id = ?1 AND account_id = ?2').bind(gameId, accountId).all<{ decision_id: string; note_json: string }>();
  return (rows.results ?? []).map((row) => ({ decisionId: row.decision_id, ...JSON.parse(row.note_json) }));
}
export function noteStatement(env: LiveGameEnv, gameId: string, accountId: string, decisionId: string, value: unknown) {
  if (value === null) return env.DB.prepare('DELETE FROM live_decision_notes WHERE game_id = ?1 AND account_id = ?2 AND decision_id = ?3').bind(gameId, accountId, decisionId);
  const note = value as { text?: unknown; flagged?: unknown };
  if (!note || typeof note.text !== 'string' || note.text.length > COMPUTER_LIMITS.noteCharacters || typeof note.flagged !== 'boolean') throw new Error('invalid_decision_note');
  return env.DB.prepare('INSERT INTO live_decision_notes (game_id, account_id, decision_id, note_json) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(game_id, account_id, decision_id) DO UPDATE SET note_json = excluded.note_json').bind(gameId, accountId, decisionId, JSON.stringify({ text: note.text, flagged: note.flagged, updatedAt: new Date().toISOString() }));
}

export async function readAttempt(env: LiveGameEnv, gameId: string, accountId: string, attemptId: string, kind: string) {
  const row = await env.DB.prepare('SELECT payload_json FROM live_decision_attempts WHERE game_id = ?1 AND account_id = ?2 AND attempt_id = ?3 AND kind = ?4').bind(gameId, accountId, attemptId, kind).first<{ payload_json: string }>();
  return row ? JSON.parse(row.payload_json) : null;
}
export async function readAttemptPage(env: LiveGameEnv, gameId: string, accountId: string, kind: string, cursor: unknown) {
  const after = cursor ?? 0;
  if (!Number.isSafeInteger(after) || Number(after) < 0) throw new Error('invalid_attempt_cursor');
  const rows = await env.DB.prepare('SELECT rowid AS sequence, attempt_id, payload_json FROM live_decision_attempts WHERE game_id = ?1 AND account_id = ?2 AND kind = ?3 AND rowid > ?4 ORDER BY rowid LIMIT ?5').bind(gameId, accountId, kind, after, COMPUTER_LIMITS.attemptPage + 1).all<{ sequence: number; attempt_id: string; payload_json: string }>();
  const items = (rows.results ?? []).slice(0, COMPUTER_LIMITS.attemptPage).map(row => ({ sequence: row.sequence, attemptId: row.attempt_id, attempt: JSON.parse(row.payload_json) }));
  return { items, nextCursor: (rows.results?.length ?? 0) > items.length ? items.at(-1)?.sequence ?? null : null };
}
export function attemptStatement(env: LiveGameEnv, gameId: string, accountId: string, attemptId: string, kind: string, value: unknown) {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(attemptId) || !['computer', 'analysis'].includes(kind) || !value || typeof value !== 'object' || encodedSyncBytes(value) > COMPUTER_LIMITS.attemptBytes) throw new Error('invalid_attempt');
  const payload = canonicalCommandJson(value);
  return env.DB.prepare('INSERT INTO live_decision_attempts (game_id, account_id, attempt_id, kind, payload_json) VALUES (?1, ?2, ?3, ?4, ?5)').bind(gameId, accountId, attemptId, kind, payload);
}
