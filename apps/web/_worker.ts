import { GameRoomDO, handleApiRequest } from "../../packages/api-handler/src";
import type { ApiEnv } from "../../packages/api-handler/src";

type AssetFetcher = {
  fetch: (request: Request) => Promise<Response>;
};

type WebEnv = ApiEnv & {
  STATIC_ASSETS: AssetFetcher;
};

const API_PREFIX = "/api/";

const shouldHandleApi = (pathname: string) => pathname === "/api" || pathname.startsWith(API_PREFIX);

export default {
  async fetch(request: Request, env: WebEnv): Promise<Response> {
    const url = new URL(request.url);
    if (shouldHandleApi(url.pathname)) {
      return handleApiRequest(request, env);
    }
    return env.STATIC_ASSETS.fetch(request);
  },
};

export { GameRoomDO };
