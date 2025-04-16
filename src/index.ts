import express, { Request, Response } from "express";
import cors from "cors";
import { WebSocketClient } from "./webSocketServer/WebSocketServer";
import Redis from "ioredis";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const ELEMENTS_STORAGE = new Map<string, any>();

const httpServer = app.listen(8080, () => {
  console.log("App is running on server http://localhost:8080");
});

const redis = new Redis();
const redisPublisher = new Redis();
const redisSubscriber = new Redis();
const webSocket = new WebSocketClient(
  httpServer,
  redis,
  redisPublisher,
  redisSubscriber
);

app.post("/create-link", (req: Request, res: Response) => {
  const { elements, panOffset, scale } = req.body;

  const id = crypto.randomUUID();
  redis.set(id, JSON.stringify({ elements, panOffset, scale }), "EX", 3600);

  console.log("Creation Id is", id);

  res.json({
    message: "Success",
    id: id,
  });
});

// Update the route handler to properly handle async/await
app.get("/fetch-elements", (req: Request, res: Response) => {
  return new Promise<void>(async (resolve) => {
    try {
      const id = req.query.id as string;

      if (!id) {
        res.status(400).json({ message: "ID is required" });
        return resolve();
      }

      const result = await redis.get(id);

      if (!result) {
        res.status(400).json({
          message: "Invalid Id / Please request another id",
        });
        return resolve();
      }

      const boardState = JSON.parse(result);

      res.status(200).json({
        message: "Success",
        ...boardState,
      });
      resolve();
    } catch (err) {
      console.error("Error fetching elements:", err);
      res.status(500).json({ message: "Internal Server Error" });
      resolve();
    }
  });
});

app.post("/start-session", async (req, res) => {
  // Create a new Room and send back the roomId
  // using which the user will join the room
  // create room will create a room in the redis
  const roomId = await webSocket.createRoom(req.body.userId);
  const { elements, scale, panOffset } = req.body;
  webSocket.initialiseWhiteboard(roomId, { elements, scale, panOffset });

  console.log("Room has been created with Id ", roomId);

  res.json({
    roomId,
  });
});
