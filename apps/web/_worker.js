import { GameRoomDO, handleApiRequest } from "../../packages/api-handler/src";

const API_PREFIX = "/api/";

const shouldHandleApi = (pathname) => pathname === "/api" || pathname.startsWith(API_PREFIX);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (shouldHandleApi(url.pathname)) {
      return handleApiRequest(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

export { GameRoomDO };
