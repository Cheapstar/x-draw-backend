---

````markdown
# 🖊️ x-draw-backend

The backend server for **x-draw**, a collaborative whiteboard application. This server handles WebSocket communication, Redis-based state management, and other core backend features.

---

## 🚀 Getting Started

### 1. 📄 Setup Environment Variables

Create a `.env` file in the root of the project by copying the example:

```bash
cp .env.example .env
```

Then fill in the required environment variables in `.env`.

---

### 2. 🔧 Install Dependencies

Make sure you're in the project directory and run:

```bash
npm install
```

---

### 3. 🔨 Build and Run

To build and start the server:

```bash
npm run build
```

> This will compile the server and start it automatically.

---

## 📦 Dependencies

- **Node.js**
- **TypeScript**
- **ioredis**
- **ws** (WebSocket library)
- **dotenv**

---

## 💬 Notes

- Make sure Redis is running. If using Docker, you can spin up Redis locally with:

  ```bash
  docker run --name xdraw-redis -p 6379:6379 -d redis
  ```

- This project assumes Redis is available at the host and port you specify in your `.env` (default: `redis://127.0.0.1:6379`).

---

## 🛠️ Scripts

- `npm run build`: Builds and starts the server
- `npm run dev`: (if available) Runs the server in development mode with hot reload

---

## 📁 File Structure (optional)

```plaintext
x-draw-backend/
├── src/
│   ├── index.ts                        # Entry point
│   ├── webSocketServer/                # WebSocket handlers
│   ├── types.ts/                       # types
├── .env.example
├── .env                  # (you create this)
├── tsconfig.json
└── package.json
```

---

## 📬 License

MIT

```

---

```
