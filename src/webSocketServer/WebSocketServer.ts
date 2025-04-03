import { Server as HTTPServer } from "http";
import WebSocket from "ws";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import { Element, ImageElement, Point } from "../types";
import randomColor from "randomcolor";

export class WebSocketClient {
  private wss: WebSocketServer;
  private CLIENTS: Map<string, WebSocket> = new Map<string, WebSocket>();
  private handlers: Map<string, Map<string, handlerFn[]>> = new Map(); // user ---> handlerfn
  private Rooms: Map<string, Map<string, UserDetails>> = new Map(); // room-Id --> userId,name
  private BoardState: Map<string, BoardStateType> = new Map(); // room-Id ---> {initialScale,panOffset,elements}

  constructor(server: HTTPServer) {
    if (!server) {
      throw new Error("HTTP Server is required to create WebSocket server");
    }

    this.wss = new WebSocketServer({ server });
    this.connect();
  }

  connect = () => {
    this.wss.on("connection", (ws, req) => {
      if (!req.url) {
        console.error("Connection attempt without user ID");
        ws.close(1008, "Missing user ID");
        return;
      }

      const urlParts = req.url.split("=");
      if (urlParts.length < 2 || !urlParts[1]) {
        console.error("Invalid user ID in connection URL");
        ws.close(1008, "Invalid user ID");
        return;
      }

      const userId = urlParts[1];

      if (!this.isValidUserId(userId)) {
        console.error("Invalid user ID format");
        ws.close(1008, "Invalid user ID format");
        return;
      }

      console.log("New Connection Established for userId:", userId);
      this.registerUser(userId, ws);

      this.initWs(userId);

      ws.on("message", (rawData) => {
        try {
          // Validate message data
          if (!rawData) {
            console.error("Received empty message");
            return;
          }

          const parsedData = JSON.parse(rawData.toString());

          // Validate message structure
          if (!parsedData.type || !("payload" in parsedData)) {
            console.error("Invalid message format", parsedData);
            return;
          }

          const { payload, type } = parsedData;

          // Execute appropriate event handlers
          const userHandlers = this.handlers.get(userId)?.get(type);
          if (!userHandlers || userHandlers.length === 0) {
            console.warn(`No handlers found for type: ${type}`);
            return;
          }

          userHandlers.forEach((handler) => {
            try {
              handler({ userId, payload });
            } catch (handlerError) {
              console.error(`Error in handler for type ${type}:`, handlerError);
            }
          });
        } catch (parseError) {
          console.error("Error parsing message:", parseError);
        }
      });

      ws.on("close", () => {
        console.log("Client connection closed for userId:", userId);

        // Check if the user is part of any room
        let userRoomId: string | null = null;

        this.Rooms.forEach((roomUsers, roomId) => {
          if (roomUsers.has(userId)) {
            userRoomId = roomId;
            roomUsers.delete(userId);
          }
        });

        // Broadcast that user left the room
        if (userRoomId) {
          console.log(`User ${userId} left room ${userRoomId}`);
          this.broadCastRoom({
            userId,
            type: "remove-participant",
            payload: { roomId: userRoomId, userId },
          });
        }

        // Cleanup resources
        this.CLIENTS.delete(userId);
        this.handlers.delete(userId);
      });

      // Add error handling for WebSocket
      ws.on("error", (error) => {
        console.error(`WebSocket error for userId ${userId}:`, error);
        this.CLIENTS.delete(userId);
        this.handlers.delete(userId);
      });
    });
  };

  private isValidUserId(userId: string): boolean {
    return userId.trim().length > 0 && userId.length <= 50;
  }

  on = (type: string, handler: handlerFn, userId: string) => {
    if (!type || typeof type !== "string") {
      throw new Error("Invalid event type");
    }
    if (!handler || typeof handler !== "function") {
      throw new Error("Invalid handler function");
    }
    if (!userId) {
      throw new Error("User ID is required");
    }

    // Ensure user handlers exist
    if (!this.handlers.has(userId)) {
      this.handlers.set(userId, new Map());
    }

    const userHandlers = this.handlers.get(userId)!;
    if (!userHandlers.has(type)) {
      userHandlers.set(type, []);
    }

    userHandlers.get(type)!.push(handler);
  };

  off = (type: string, handler: handlerFn, userId: string) => {
    if (!type || !handler || !userId) {
      console.warn("Invalid parameters for off method");
      return;
    }

    const userHandlers = this.handlers.get(userId);
    if (!userHandlers?.has(type)) return;

    const handlers = userHandlers.get(type)!;
    const index = handlers.indexOf(handler);

    if (index !== -1) {
      handlers.splice(index, 1);
    }
  };

  send = (userId: string, type: string, payload: any) => {
    if (!userId || !type) {
      console.error("Invalid send parameters");
      return;
    }

    const ws = this.CLIENTS.get(userId);

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const message = { type, payload };
        ws.send(JSON.stringify(message));
      } catch (sendError) {
        console.error("Error sending WebSocket message:", sendError);
      }
    } else {
      console.warn(`WebSocket not connected for userId: ${userId}`);
    }
  };

  registerUser = (userId: string, ws: WebSocket) => {
    if (!userId || !ws) {
      console.error("Invalid user registration parameters");
      return;
    }

    // Store the user
    this.CLIENTS.set(userId, ws);

    if (!this.handlers.has(userId)) {
      this.handlers.set(userId, new Map());
    }

    console.log("User has been Registered:", userId);

    this.send(userId, "userRegistered", {
      message: "User has Been Registered Successfully",
    });
  };

  public getClientIds = (): string[] => {
    return Array.from(this.CLIENTS.keys());
  };

  public createRoom = (): string => {
    const roomId = crypto.randomUUID();
    this.Rooms.set(roomId, new Map<string, UserDetails>());

    return roomId;
  };

  private joinRoom = ({ userId, payload }: Args) => {
    if (!userId || !payload || !payload.roomId) {
      console.warn("Invalid room join parameters");
      return;
    }

    const { roomId, name } = payload;
    const userColor = randomColor();

    // Check if room exists
    if (!this.Rooms.has(roomId)) {
      console.warn(`Attempt to join non-existent room: ${roomId}`);
      return;
    }

    this.Rooms.get(roomId)?.set(userId, {
      userName: name || "Anonymous",
      color: userColor,
    });
    const boardState = this.BoardState.get(roomId);
    console.log("User with name has joined", name);

    if (!boardState) {
      console.warn("No Board State Present for the given Room");
      return;
    }

    this.send(userId, "room-joined", { ...boardState });
  };

  private leaveRoom = ({ userId, payload }: Args) => {
    if (!userId || !payload.roomId) {
      console.warn("Invalid room leave parameters");
      return;
    }

    // Check if room exists before attempting to remove user
    if (this.Rooms.has(payload.roomId)) {
      this.Rooms.get(payload.roomId)?.delete(userId);

      console.log("User has left the Room");
      this.broadCastRoom({
        userId,
        type: "remove-participant",
        payload: { roomId: payload.roomId, userId },
      });

      if (this.Rooms.get(payload.roomId)?.size === 0) {
        this.Rooms.delete(payload.roomId);
      }
    }
  };

  initialiseWhiteboard = (roomId: string, details: BoardStateType) => {
    if (this.BoardState.has(roomId)) {
      console.log("Room Already Exists! Reset the Session");
      return;
    }
    this.BoardState.set(roomId, { ...details });
  };

  private handleMousePosition = ({ userId, payload }: Args) => {
    const userDetails = this.Rooms.get(payload.roomId)?.get(userId);
    this.broadCastRoom({
      userId,
      type: "participant-position",
      payload: { ...payload, userDetails },
    });
  };

  private broadCastRoom = ({ userId, type, payload }: BroadCastRoom) => {
    // Collect all the userId except the sender
    if (this.Rooms.has(payload.roomId)) {
      const receivers = Array.from(
        (this.Rooms.get(payload.roomId) as Map<string, UserDetails>).keys()
      );

      for (const rec of receivers) {
        if (rec !== userId) {
          this.send(rec, type, payload);
        }
      }
    }
  };

  private handleNewElement = ({ userId, payload }: Args) => {
    const { element, roomId } = payload as NewElementPayload;

    this.broadCastRoom({
      userId,
      type: "draw-element",
      payload: { newElement: element, roomId },
    });

    this.updateBoardState({ roomId, element });
  };

  private handleElementMove = ({ userId, payload }: Args) => {
    const { element, roomId } = payload;

    // broadcast this into the room
    this.broadCastRoom({ userId, type: "move-element", payload });

    this.updateBoardState({ roomId, element });
  };

  private handleElementResize = ({ userId, payload }: Args) => {
    const { element, roomId } = payload;

    this.broadCastRoom({ userId, type: "resize-element", payload });

    this.updateBoardState({
      roomId,
      element,
    });
  };

  private eraseElements = (eraseElements: Element[], roomId: string) => {
    const boardState = this.BoardState.get(roomId);

    if (!boardState) {
      console.warn(`No board state found for room: ${roomId}`);
      return;
    }

    boardState.elements.filter(
      (element) =>
        !eraseElements.some((eraseElement) => eraseElement.id === element.id)
    );
  };

  private handleElementErase = ({ userId, payload }: Args) => {
    this.broadCastRoom({ userId, type: "erase-elements", payload });
    this.eraseElements(payload.elements, payload.roomId);
  };

  private handleElementUpdate = ({ userId, payload }: Args) => {
    this.broadCastRoom({ userId, type: "update-element", payload });

    this.updateBoardState({ roomId: payload.roomId, element: payload.element });
  };

  private handleImageAdd = ({ userId, payload }: Args) => {
    console.log("Image is Received");
    this.broadCastRoom({ userId, type: "add-images", payload });

    for (let i = 0; i < payload.elements.length; i++) {
      this.updateBoardState({
        roomId: payload.roomId,
        element: payload.elements[i],
      });
    }
  };

  private updateBoardState = ({ roomId, element }: BoardStateUpdate) => {
    // Ensure the room exists in BoardState
    const boardState = this.BoardState.get(roomId);
    if (!boardState) {
      console.warn(`No board state found for room: ${roomId}`);
      return;
    }

    // Update elements immutably
    const updatedElements = boardState.elements.map((ele) => {
      if (ele.id === element.id) {
        if (element.type === "image") {
          return {
            ...element,
            url: (ele as ImageElement).url,
          };
        }

        return element;
      }
      return ele;
    });

    // If element is new, add it
    if (!updatedElements.some((ele) => ele.id === element.id)) {
      updatedElements.push(element);
    }

    // Mutate `BoardState` safely
    boardState.elements = updatedElements;
  };

  private initWs = (userId: string) => {
    this.on("join-room", this.joinRoom, userId);
    this.on("leave-room", this.leaveRoom, userId);
    this.on("mouse-position", this.handleMousePosition, userId);
    this.on("drawing-element", this.handleNewElement, userId);
    this.on("element-resize", this.handleElementResize, userId);
    this.on("element-moves", this.handleElementMove, userId);
    this.on("elements-erase", this.handleElementErase, userId);
    this.on("element-update", this.handleElementUpdate, userId);
    this.on("images-added", this.handleImageAdd, userId);
  };
}

interface handlerFn {
  ({
    userId,
    payload,
  }: {
    userId: string;
    payload?: any;
  }): Promise<void> | void;
}

interface Args {
  userId: string;
  payload?: any;
}

interface BoardStateType {
  elements: Element[];
  scale: number;
  panOffset: Point;
}

interface BroadCastRoom {
  userId: string;
  type: string;
  payload: any;
}

interface UserDetails {
  userName: string;
  color: string;
}

interface NewElementPayload {
  element: Element;
  roomId: string;
}

interface BoardStateUpdate {
  roomId: string;
  element: Element;
}
