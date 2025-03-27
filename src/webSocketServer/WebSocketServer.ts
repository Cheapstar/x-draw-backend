import { Server as HTTPServer } from "http";
import WebSocket from "ws";
import { WebSocketServer } from "ws";
// Each Request must come with the userId of the client
// structure of the request {
//  type:"",
//  payload:{}
// }

// Major change needed
export class WebSocketClient {
  private wss: WebSocketServer;
  private CLIENTS: Map<string, WebSocket> = new Map<string, WebSocket>(); // userId --- WS
  private handlers: Map<string, Map<string, handlerFn[]>> = new Map(); // userId --- (type --- handler)

  constructor(server: HTTPServer) {
    this.wss = new WebSocketServer({ server });

    this.connect();
  }

  connect = () => {
    this.wss.on("connection", (ws, req) => {
      console.log("New Connection Established");

      const userId = req.url?.split("=")[1] as string;
      console.log("userId", userId);
      this.registerUser(userId, ws);

      ws.on("message", (rawData) => {
        console.log("Ya hello %s", rawData);
        const parsedData = JSON.parse(rawData.toString());
        const payload = parsedData.payload;
        const type = parsedData.type;
        console.log(parsedData);

        // execute the appropriate event handlers
        const userHandlers = this.handlers.get(userId as string)?.get(type);
        userHandlers?.forEach((handler) => handler({ userId, payload }));
      });

      ws.on("close", () => {
        console.log("Client has terminated the connection");
        // Remove the user from CLIENTS and handlers maps
        if (userId) {
          this.CLIENTS.delete(userId);
          this.handlers.delete(userId);
        }
      });
    });
  };

  // registering the handlers
  on = (type: string, handler: handlerFn, userId: string) => {
    const userHandlers = this.handlers.get(userId);
    if (!userHandlers?.has(type)) {
      userHandlers?.set(type, [] as handlerFn[]);
    }

    userHandlers?.get(type)?.push(handler);
  };

  // removing the handlers
  off = (type: string, handler: handlerFn, userId: string) => {
    const userHandlers = this.handlers.get(userId);
    if (!userHandlers?.has(type)) return;
    const handlers = userHandlers?.get(type);
    const index = handlers?.indexOf(handler);
    if (index !== -1) {
      handlers?.splice(index as number, 1);
    }
  };

  // to send the message
  send = (userId: string, type: string, payload: any) => {
    const ws = this.CLIENTS.get(userId);

    if (ws && ws.readyState === WebSocket.OPEN) {
      const message = {
        type,
        payload,
      };

      ws.send(JSON.stringify(message));
    } else {
      console.error("WebSocket is not connnected");
    }
  };

  registerUser = (userId: string, ws: WebSocket) => {
    // storing the user
    this.CLIENTS.set(userId, ws as WebSocket);

    if (!this.handlers.has(userId)) {
      this.handlers.set(userId, new Map());
    }

    console.log("User has been Registered Congo");

    this.send(userId, "userRegisterd", {
      message: "User has Been Registered Thank You",
    });
  };

  // Helper method to get all connected client IDs
  public getClientIds = (): string[] => {
    return Array.from(this.CLIENTS.keys());
  };
}

// on join-room everything begins

interface handlerFn {
  ({
    userId,
    payload,
  }: {
    userId: string;
    payload?: any;
  }): Promise<void> | void;
}
