import { Server as HTTPServer } from "http";
import WebSocket from "ws";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import { Element, ImageElement, Point } from "../types";
import randomColor from "randomcolor";
import { Redis } from "ioredis";

// Redis Key Structure , just learned
const KEYS = {
  USER_STATUS: (userId: string) => `user:${userId}:status`,
  ROOM_USERS: (roomId: string) => `room:${roomId}:users`,
  ROOM_USER_DETAILS: (roomId: string, userId: string) =>
    `room:${roomId}:user:${userId}`,
  ROOM_MEMBERS: (roomId: string) => `room:${roomId}:members`,
  WHITEBOARD_DATA: (roomId: string) => `whiteboard:${roomId}:data`,
};

export class WebSocketClient {
  private wss: WebSocketServer;
  private CLIENTS: Map<string, WebSocket> = new Map<string, WebSocket>(); // Storing Those ws which are connected to this server instance only
  private handlers: Map<string, Map<string, handlerFn[]>> = new Map();
  private redis: Redis;
  private redisPublisher: Redis;
  private redisSubscriber: Redis;
  private jobQueue: Promise<void> = Promise.resolve();

  constructor(
    server: HTTPServer,
    redis: Redis,
    redisPublisher: Redis,
    redisSubscriber: Redis
  ) {
    if (!server) {
      throw new Error("HTTP Server is required to create WebSocket server");
    }

    this.wss = new WebSocketServer({ server });
    this.redis = redis;
    this.redisPublisher = redisPublisher;
    this.redisSubscriber = redisSubscriber;
    this.setUpRedis();
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
          const typeHandlers = this.handlers.get(userId)?.get(type);
          if (!typeHandlers || typeHandlers.length === 0) {
            console.warn(`No handlers found for type: ${type}`);
            return;
          }

          const nextJob = this.jobQueue.then(async () => {
            await Promise.all(
              typeHandlers.map((handler) => handler({ userId, payload }))
            );
          });

          this.jobQueue = nextJob;

          nextJob.catch((err) => {
            console.log("Error Occured While executing the Job", err);
          });
        } catch (parseError) {
          console.error("Error parsing message:", parseError);
        }
      });

      ws.on("close", async () => {
        console.log("Client connection closed for userId:", userId);

        try {
          // Find all rooms the user is in
          const userRooms = await this.findUserRooms(userId);

          // Handle user leaving each room
          for (const roomId of userRooms) {
            await this.handleUserLeaveRoom(userId, roomId);
          }

          // Clean up resources
          this.CLIENTS.delete(userId);
          this.handlers.delete(userId);
          await this.redis.del(KEYS.USER_STATUS(userId));
        } catch (error) {
          console.error(
            `Error handling WebSocket close for userId ${userId}:`,
            error
          );
        }
      });

      // Add error handling for WebSocket
      ws.on("error", (error) => {
        console.error(`WebSocket error for userId ${userId}:`, error);
        this.CLIENTS.delete(userId);
        this.handlers.delete(userId);
      });
    });
  };

  private async findUserRooms(userId: string): Promise<string[]> {
    try {
      // Get all keys that might indicate room membership
      const keys = await this.redis.keys(`room:*:members`);
      const userRooms: string[] = [];

      for (const key of keys) {
        const isMember = await this.redis.sismember(key, userId);
        if (isMember) {
          // Extract roomId from the key pattern
          const roomId = key.split(":")[1];
          userRooms.push(roomId);
        }
      }

      return userRooms;
    } catch (error) {
      console.error(`Error finding rooms for user ${userId}:`, error);
      return [];
    }
  }

  private async handleUserLeaveRoom(userId: string, roomId: string) {
    try {
      console.log(`User ${userId} left room ${roomId}`);

      // Remove user from room members
      await this.redis.srem(KEYS.ROOM_MEMBERS(roomId), userId);

      // Remove user details
      await this.redis.del(KEYS.ROOM_USER_DETAILS(roomId, userId));

      // Broadcast user left message
      this.broadCastRoom({
        userId,
        type: "remove-participant",
        payload: { roomId, userId },
      });

      // Check if room is empty and clean up if needed
      const membersCount = await this.redis.scard(KEYS.ROOM_MEMBERS(roomId));
      if (membersCount === 0) {
        await this.cleanupEmptyRoom(roomId);
      }
    } catch (error) {
      console.error(
        `Error handling user ${userId} leaving room ${roomId}:`,
        error
      );
    }
  }

  private async cleanupEmptyRoom(roomId: string) {
    try {
      console.log(`Cleaning up empty room ${roomId}`);

      // Delete room data
      const pipeline = this.redis.pipeline();
      pipeline.del(KEYS.ROOM_MEMBERS(roomId));
      pipeline.del(KEYS.WHITEBOARD_DATA(roomId));

      // Delete any other room-related keys
      const roomKeys = await this.redis.keys(`room:${roomId}:*`);
      for (const key of roomKeys) {
        pipeline.del(key);
      }

      await pipeline.exec();
      console.log(`Room ${roomId} cleaned up successfully`);
    } catch (error) {
      console.error(`Error cleaning up room ${roomId}:`, error);
    }
  }

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

  send = async (userId: string, type: string, payload: any) => {
    if (!userId || !type) {
      console.error("Invalid send parameters");
      return;
    }

    try {
      const ws = this.CLIENTS.get(userId);
      const userStatus = await this.redis.get(KEYS.USER_STATUS(userId));

      if (userStatus !== "1") {
        console.log(`User ${userId} is offline, skipping message`);
        return;
      }

      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          const message = { type, payload };
          ws.send(JSON.stringify(message));
        } catch (sendError) {
          console.error("Error sending WebSocket message:", sendError);
        }
      } else {
        // User is connected to a different server instance
        this.redisPublisher.publish(
          "message-channel",
          JSON.stringify({ type, payload, userId })
        );

        console.log(
          `WebSocket not connected on this server instance, sending to other server: ${userId}`
        );
      }
    } catch (error) {
      console.error(`Error in send method for user ${userId}:`, error);
    }
  };

  registerUser = async (userId: string, ws: WebSocket) => {
    if (!userId || !ws) {
      console.error("Invalid user registration parameters");
      return;
    }

    try {
      // Store the user connection
      this.CLIENTS.set(userId, ws);

      // Set user as online in Redis
      await this.redis.set(KEYS.USER_STATUS(userId), "1", "EX", 7200); // TTL to prevent orphaned keys , not necessary but just checking

      if (!this.handlers.has(userId)) {
        this.handlers.set(userId, new Map());
      }

      console.log("User has been Registered:", userId);

      this.send(userId, "userRegistered", {
        message: "User has Been Registered Successfully",
      });
    } catch (error) {
      console.error(`Error registering user ${userId}:`, error);
    }
  };

  setUpRedis = () => {
    this.redisSubscriber.subscribe("message-channel");

    this.redisSubscriber.on("message", (_, raw) => {
      try {
        const { type, payload, userId } = JSON.parse(raw);

        const recpWs = this.CLIENTS.get(userId);

        if (recpWs && recpWs.readyState === WebSocket.OPEN) {
          recpWs.send(JSON.stringify({ type, payload }));
        }
      } catch (error) {
        console.error("Error processing Redis message:", error);
      }
    });

    console.log("Redis pub/sub setup complete");
  };

  public getClientIds = (): string[] => {
    return Array.from(this.CLIENTS.keys());
  };

  public createRoom = async (userId: string): Promise<string> => {
    const roomId = crypto.randomUUID();
    console.log(`Creating new room with ID: ${roomId} for user ${userId}`);
    return roomId;
  };

  private joinRoom = async ({ userId, payload }: Args) => {
    if (!userId || !payload || !payload.roomId) {
      console.warn("Invalid room join parameters");
      return;
    }

    try {
      const { roomId, name } = payload;
      const userColor = randomColor();

      // Store user details in Redis
      const userDetails = {
        userName: name || "Anonymous",
        color: userColor,
      };

      await this.redis.set(
        KEYS.ROOM_USER_DETAILS(roomId, userId),
        JSON.stringify(userDetails)
      );

      // Add user to room members
      await this.redis.sadd(KEYS.ROOM_MEMBERS(roomId), userId);

      // Get board state
      const boardStateJson = await this.redis.get(KEYS.WHITEBOARD_DATA(roomId));

      if (!boardStateJson) {
        console.warn(`No board state found for room: ${roomId}`);
        return;
      }

      console.log(`User ${name} (${userId}) joined room ${roomId}`);

      // Send room data to the user
      this.send(userId, "room-joined", JSON.parse(boardStateJson));

      // Broadcast to others that someone joined
      this.broadCastRoom({
        userId,
        type: "add-participant",
        payload: { roomId, userId, userDetails },
      });
    } catch (error) {
      console.error(`Error joining room for user ${userId}:`, error);
    }
  };

  private leaveRoom = async ({ userId, payload }: Args) => {
    if (!userId || !payload || !payload.roomId) {
      console.warn("Invalid room leave parameters");
      return;
    }

    try {
      const { roomId } = payload;
      await this.handleUserLeaveRoom(userId, roomId);
    } catch (error) {
      console.error(`Error leaving room for user ${userId}:`, error);
    }
  };

  initialiseWhiteboard = async (roomId: string, details: BoardStateType) => {
    try {
      // Check if room whiteboard data already exists
      const exists = await this.redis.exists(KEYS.WHITEBOARD_DATA(roomId));

      if (exists) {
        console.log(`Room ${roomId} already exists! Reset the session`);
        return;
      }

      // Store the initial whiteboard data
      await this.redis.set(
        KEYS.WHITEBOARD_DATA(roomId),
        JSON.stringify(details),
        "EX",
        86400 // 24 hour TTL to prevent orphaned data
      );

      console.log(`Whiteboard initialized for room ${roomId}`);
    } catch (error) {
      console.error(`Error initializing whiteboard for room ${roomId}:`, error);
    }
  };

  private handleMousePosition = async ({ userId, payload }: Args) => {
    try {
      if (!payload || !payload.roomId) {
        console.warn("Invalid mouse position payload");
        return;
      }

      const userDetailsJson = await this.redis.get(
        KEYS.ROOM_USER_DETAILS(payload.roomId, userId)
      );

      if (!userDetailsJson) {
        console.warn(
          `User details not found for user ${userId} in room ${payload.roomId}`
        );
        return;
      }

      this.broadCastRoom({
        userId,
        type: "participant-position",
        payload: {
          ...payload,
          userDetails: JSON.parse(userDetailsJson),
        },
      });
    } catch (error) {
      console.error(`Error handling mouse position for user ${userId}:`, error);
    }
  };

  private broadCastRoom = async ({ userId, type, payload }: BroadCastRoom) => {
    try {
      if (!payload || !payload.roomId) {
        console.warn("Invalid broadcast parameters");
        return;
      }

      // Check if room exists
      const exists = await this.roomExists(payload.roomId);

      if (!exists) {
        console.warn(
          `Attempted to broadcast to non-existent room: ${payload.roomId}`
        );
        return;
      }

      // Get all room members
      const members = await this.redis.smembers(
        KEYS.ROOM_MEMBERS(payload.roomId)
      );

      // Send message to all members except sender
      for (const memberId of members) {
        if (memberId !== userId) {
          await this.send(memberId, type, payload);
        }
      }
    } catch (error) {
      console.error(`Error broadcasting to room:`, error);
    }
  };

  private handleNewElement = async ({ userId, payload }: Args) => {
    try {
      if (!payload) {
        console.warn("Invalid new element payload");
        return;
      }

      const { element, roomId } = payload as NewElementPayload;

      if (!element || !roomId) {
        console.warn("Missing element or roomId in payload");
        return;
      }

      // Broadcast to all room members
      await this.broadCastRoom({
        userId,
        type: "draw-element",
        payload: { newElement: element, roomId },
      });

      // Update board state
      await this.updateBoardState({ roomId, element });
    } catch (error) {
      console.error(`Error handling new element:`, error);
    }
  };

  private handleElementMove = async ({ userId, payload }: Args) => {
    try {
      if (!payload || !payload.element || !payload.roomId) {
        console.warn("Invalid element move payload");
        return;
      }

      const { element, roomId } = payload;

      // Broadcast to room
      await this.broadCastRoom({
        userId,
        type: "move-element",
        payload,
      });

      // Update board state
      await this.updateBoardState({ roomId, element });
    } catch (error) {
      console.error(`Error handling element move:`, error);
    }
  };

  private handleElementResize = async ({ userId, payload }: Args) => {
    try {
      if (!payload || !payload.element || !payload.roomId) {
        console.warn("Invalid element resize payload");
        return;
      }

      const { element, roomId } = payload;

      // Broadcast to room
      await this.broadCastRoom({
        userId,
        type: "resize-element",
        payload,
      });

      // Update board state
      await this.updateBoardState({ roomId, element });
    } catch (error) {
      console.error(`Error handling element resize:`, error);
    }
  };

  private eraseElements = async (
    eraseElements: Element[],
    roomId: string,
    userId: string
  ) => {
    try {
      // Get current board state
      const boardStateJson = await this.redis.get(KEYS.WHITEBOARD_DATA(roomId));

      if (!boardStateJson) {
        console.warn(`No board state found for room: ${roomId}`);
        return;
      }

      const boardState = JSON.parse(boardStateJson);

      // Filter out erased elements
      const updatedElements = boardState.elements.filter(
        (element: Element) =>
          !eraseElements.some((eraseElement) => eraseElement.id === element.id)
      );

      // Update board state
      await this.redis.set(
        KEYS.WHITEBOARD_DATA(roomId),
        JSON.stringify({
          ...boardState,
          elements: updatedElements,
        })
      );

      console.log(
        `Erased ${eraseElements.length} elements from room ${roomId}`
      );
    } catch (error) {
      console.error(`Error erasing elements:`, error);
    }
  };

  private handleElementErase = async ({ userId, payload }: Args) => {
    try {
      if (!payload || !payload.elements || !payload.roomId) {
        console.warn("Invalid element erase payload");
        return;
      }

      // Broadcast to room
      await this.broadCastRoom({
        userId,
        type: "erase-elements",
        payload,
      });

      // Update board state
      await this.eraseElements(payload.elements, payload.roomId, userId);
    } catch (error) {
      console.error(`Error handling element erase:`, error);
    }
  };

  private handleElementUpdate = async ({ userId, payload }: Args) => {
    try {
      if (!payload || !payload.element || !payload.roomId) {
        console.warn("Invalid element update payload");
        return;
      }

      // Broadcast to room
      await this.broadCastRoom({
        userId,
        type: "update-element",
        payload,
      });

      // Update board state
      await this.updateBoardState({
        roomId: payload.roomId,
        element: payload.element,
      });
    } catch (error) {
      console.error(`Error handling element update:`, error);
    }
  };

  private handleImageAdd = async ({ userId, payload }: Args) => {
    try {
      if (!payload || !payload.elements || !payload.roomId) {
        console.warn("Invalid image add payload");
        return;
      }

      console.log(
        `Processing ${payload.elements.length} images for room ${payload.roomId}`
      );

      // Broadcast to room
      await this.broadCastRoom({
        userId,
        type: "add-images",
        payload,
      });

      // Update board state for each image
      for (const element of payload.elements) {
        await this.updateBoardState({
          roomId: payload.roomId,
          element: element,
        });
      }
    } catch (error) {
      console.error(`Error handling image add:`, error);
    }
  };

  private updateBoardState = async ({ roomId, element }: BoardStateUpdate) => {
    try {
      // Get current board state
      const boardStateJson = await this.redis.get(KEYS.WHITEBOARD_DATA(roomId));

      if (!boardStateJson) {
        console.warn(`No board state found for room: ${roomId}`);
        return;
      }

      const boardState = JSON.parse(boardStateJson);

      // Look for existing element to update
      let elementExists = false;
      const updatedElements = boardState.elements.map((ele: Element) => {
        if (ele.id === element.id) {
          elementExists = true;

          if (element.type === "image" && (ele as ImageElement).url) {
            return {
              ...element,
              url: (ele as ImageElement).url,
            };
          }

          return { ...element };
        }
        return ele;
      });

      // If element is new, add it
      if (!elementExists) {
        updatedElements.push(element);
      }

      // Update Redis with new board state
      await this.redis.set(
        KEYS.WHITEBOARD_DATA(roomId),
        JSON.stringify({ ...boardState, elements: updatedElements })
      );
    } catch (error) {
      console.error(`Error updating board state:`, error);
    }
  };

  private roomExists = async (roomId: string): Promise<boolean> => {
    try {
      const exists = await this.redis.exists(KEYS.ROOM_MEMBERS(roomId));
      return exists === 1;
    } catch (error) {
      console.error(`Error checking if room ${roomId} exists:`, error);
      return false;
    }
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
