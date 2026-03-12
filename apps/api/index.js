import { GameRoomDO, handleApiRequest } from "../../packages/api-handler/src/index.ts";

export default {
  async fetch(request, env) {
    return handleApiRequest(request, env);
  },
};

export { GameRoomDO };
