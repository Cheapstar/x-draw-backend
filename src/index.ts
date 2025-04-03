import express, { Request, Response } from "express";
import cors from "cors";
import { WebSocketClient } from "./webSocketServer/WebSocketServer";
const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const ELEMENTS_STORAGE = new Map<string, any>();

app.post("/create-link", (req: Request, res: Response) => {
  const { elements, panOffset, scale } = req.body;

  const id = crypto.randomUUID();
  ELEMENTS_STORAGE.set(id, { elements, panOffset, scale });

  console.log("Creation Id is", id);

  res.json({
    message: "Success",
    id: id,
  });
});

app.get("/fetch-elements", (req, res) => {
  const id = req.query.id;

  console.log("Received ID is ", id);
  const { elements, panOffset, scale } = ELEMENTS_STORAGE.get(id as string);

  res.json({
    message: "Sucess",
    elements: elements,
    panOffset,
    scale,
  });
});

app.post("/start-session", (req, res) => {
  // Create a new Room and send back the roomId
  // using which the user will join the room
  const roomId = webSocket.createRoom();
  const { elements, scale, panOffset } = req.body;
  webSocket.initialiseWhiteboard(roomId, { elements, scale, panOffset });

  console.log("Room has been created with Id ", roomId);

  res.json({
    roomId,
  });
});

const httpServer = app.listen(8080, () => {
  console.log("App is running on server http://localhost:8080");
});

const webSocket = new WebSocketClient(httpServer);
