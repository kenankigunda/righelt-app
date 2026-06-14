export type CommandType =
  | "move"
  | "project"
  | "rush"
  | "push"
  | "follow"
  | "retreat"
  | "join_as_viewer"
  | "request_join_as_player"
  | "approve_join_request"
  | "exit_playground";

export type CommandSource = "player_invite" | "viewer_invite" | "home_list" | "direct";

export type ClientCommand = {
  type: CommandType;
  gameId: string | null;
  actorDeviceId: string;
  source?: CommandSource;
  payload?: Record<string, unknown>;
  clientCommandId?: string;
};
