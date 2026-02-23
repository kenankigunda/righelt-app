import { handleApiRequest } from "../../../packages/api-handler/src";

type Env = {
  DB: {
    prepare: (query: string) => {
      bind: (...args: unknown[]) => {
        run: () => Promise<{ success: boolean; meta?: { last_row_id?: number } }>;
      };
    };
  };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type"
        }
      });
    }

    const response = await handleApiRequest(request, env);
    response.headers.set("access-control-allow-origin", "*");
    response.headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
    response.headers.set("access-control-allow-headers", "content-type");
    return response;
  }
};
