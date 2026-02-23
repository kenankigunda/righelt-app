export type EventType =
  | "state_sync"
  | "event_appended"
  | "presence_changed"
  | "join_request_created"
  | "join_request_resolved"
  | "playground_exited"
  | "test_action_recorded"
  | "error";

export type ServerEvent = {
  type: EventType;
  gameId: string | null;
  at: string;
  payload?: Record<string, unknown>;
};

