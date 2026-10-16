import { GameRoomDO, handleApiRequest, runStorageMaintenance } from "../../packages/api-handler/src/index.ts";

export default {
  async fetch(request, env) {
    return handleApiRequest(request, env);
  },
  async scheduled(_event,env,context) {
    context.waitUntil(runStorageMaintenance(env));
  },
};

export { GameRoomDO };
