import {LOCAL_DEV_PORT_VARIANTS} from "../../apps/web/local-dev-ports.js";
export const AUTH_WEB_PORT=LOCAL_DEV_PORT_VARIANTS.find(v=>v.suffix==="auth-e2e").webPort;
export const AUTH_CONTROL_ORIGIN=`http://127.0.0.1:${AUTH_WEB_PORT+100}`;
