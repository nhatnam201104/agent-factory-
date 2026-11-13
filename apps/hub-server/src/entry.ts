import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startHubServer } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4747);
const stateDir = resolve(process.env.FACTORY_ARENA_STATE_DIR ?? ".factory-arena");
const staticUiDir = resolve(__dirname, "../../web-arena/dist");

const running = await startHubServer({
  port,
  stateDir,
  staticUiDir,
  seedDemoOffice: true
});

console.log(`Factory Virtual Office & Arena Hub running at ${running.baseUrl}`);
