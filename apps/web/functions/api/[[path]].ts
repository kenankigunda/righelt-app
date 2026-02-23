import { handleApiRequest } from "../../../../packages/api-handler/src";

type Env = {
  DB: {
    prepare: (query: string) => {
      bind: (...args: unknown[]) => {
        run: () => Promise<{ success: boolean; meta?: { last_row_id?: number } }>;
      };
    };
  };
};

type PagesContext = {
  request: Request;
  env: Env;
};

export const onRequest = async (context: PagesContext): Promise<Response> => {
  return handleApiRequest(context.request, context.env);
};

