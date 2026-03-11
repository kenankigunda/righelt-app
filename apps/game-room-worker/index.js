import { GameRoomDO } from "../../packages/api-handler/src";

export default {
  async fetch() {
    return new Response("Game room worker", { status: 404 });
  },
};

export { GameRoomDO };
