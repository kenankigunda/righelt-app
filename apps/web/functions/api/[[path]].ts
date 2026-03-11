import { handleApiRequest } from "../../../../packages/api-handler/src";
import type { ApiEnv } from "../../../../packages/api-handler/src";

type PagesContext = {
  request: Request;
  env: ApiEnv;
};

export const onRequest = async (context: PagesContext): Promise<Response> => {
  return handleApiRequest(context.request, context.env);
};

export { GameRoomDO } from "../../../../packages/api-handler/src";
