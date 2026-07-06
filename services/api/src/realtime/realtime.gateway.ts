import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { WebSocketServer } from "ws";
import { appState } from "../app-state.js";

@Injectable()
export class RealtimeGateway implements OnModuleInit {
  private readonly logger = new Logger(RealtimeGateway.name);

  onModuleInit() {
    const port = Number(process.env.WS_PORT ?? "3002");
    const server = new WebSocketServer({ port, path: "/ws" });
    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "snapshot", devices: Array.from(appState.store.devices.values()) }));
      socket.on("message", (raw) => {
        socket.send(JSON.stringify({ type: "echo", payload: raw.toString() }));
      });
    });
    this.logger.log(`WebSocket gateway listening on ws://0.0.0.0:${port}/ws`);
  }
}
