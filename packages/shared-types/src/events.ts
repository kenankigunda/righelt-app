export type LiveGamePayload = Record<string, unknown>;

export type StateSyncEvent = {
  type: "state_sync";
  eventSeq: number;
  reason: string;
  game: LiveGamePayload;
};

export type EventAppendedEvent = {
  type: "event_appended";
  eventSeq: number;
  reason: string;
  clientCommandId?: string | null;
  game: LiveGamePayload;
};

export type PresenceChangedEvent = {
  type: "presence_changed";
  eventSeq: number;
  identityId: string;
  role: "Player 1" | "Player 2" | "Viewer";
  roles?: Array<"Player 1" | "Player 2" | "Viewer">;
  connected: boolean;
  game: LiveGamePayload;
};

export type JoinRequestCreatedEvent = {
  type: "join_request_created";
  eventSeq: number;
  requesterIdentityId: string;
  requestedSeat: "Player 1" | "Player 2";
  game: LiveGamePayload;
};

export type JoinRequestResolvedEvent = {
  type: "join_request_resolved";
  eventSeq: number;
  requesterIdentityId: string;
  accepted: boolean;
  seat: "Player 1" | "Player 2" | null;
  game: LiveGamePayload;
};

export type ErrorEvent = {
  type: "error";
  code: string;
  message: string;
};

export type ServerEvent =
  | StateSyncEvent
  | EventAppendedEvent
  | PresenceChangedEvent
  | JoinRequestCreatedEvent
  | JoinRequestResolvedEvent
  | ErrorEvent;

export type ClientSocketMessage =
  | {
      type: "heartbeat";
      identityId: string;
      sessionId: string;
      lastEventSeq: number;
    }
  | {
      type: "inactive" | "disconnecting";
      identityId: string;
      sessionId: string;
      lastEventSeq: number;
    };
