import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { registerRealtime } from "./src/server/realtime";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev });
const handler = app.getRequestHandler();

await app.prepare();
const httpServer = createServer(handler);
const io = new Server(httpServer, { path: "/api/socket", maxHttpBufferSize: 1e6 });
registerRealtime(io);
httpServer.listen(port, () => console.log(`BlinkRoom ready at http://localhost:${port}`));
