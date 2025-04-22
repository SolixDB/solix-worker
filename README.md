🚀 Solix Worker

Solix Worker is a **Redis-based job queue processor** using **BullMQ** and **Inhouse Redis**. It efficiently processes **webhook events** and **transaction data** in the background, managing jobs from two dedicated queues: `webhookQueue` and `feedingQueue`. It integrates with **Prisma** for database operations, maintains an **in-memory cache** for fast access, and ensures seamless transaction handling, including credit updates and data insertion.

---

## 📂 Project Structure
```
solix-worker/
├── LICENSE
├── package.json
├── prisma
│   └── schema.prisma
├── README.md
├── src
│   ├── cache
│   │   └── globalCache.ts
│   ├── db
│   │   ├── prisma.ts
│   │   └── redis.ts
│   ├── index.ts
│   ├── lib
│   │   ├── cacheData.ts
│   │   ├── encrypt.ts
│   │   ├── feedData.ts
│   │   └── processData.ts
│   ├── types
│   │   └── params.ts
│   └── utils
│       ├── dbUtils.ts
│       └── tableUtils.ts
└── tsconfig.json
```

---

## 🛠 Installation & Setup

### 1️⃣ Clone the Repository
```sh
git clone https://github.com/solixdb/solix-worker.git
cd solix-worker
```

### 2️⃣ Install Dependencies
```sh
pnpm install
```

### 3️⃣ Create `.env` File
```sh
touch .env
```

Add the following environment variables:
```
ENCRYPTION_KEY = <>
ENCRYPTION_IV = <>
DATABASE_URL = <>
HELIUS_MAINNET_API_KEY  = <>
HELIUS_DEVNET_API_KEY  = <>
MAINNET_WEBHOOK_ID  = <>
DEVNET_WEBHOOK_ID  = <>
WEBHOOK_MAINNET_SECRET  = <>
WEBHOOK_DEVNET_SECRET  = <>
REDIS_QUEUE_NAME = <>
REDIS_FEEDING_QUEUE = <>
NODE_ENV = <>
REDIS_HOST = <>
REDIS_PORT  = <>
REDIS_PASSWORD  = <>
REDIS_DB  = <>
```

## 🛠 Scripts

```json
{
  "scripts": {
    "postinstall": "prisma generate",
    "dev": "tsx src/worker.ts",
    "build": "tsc",
    "start": "node dist/worker.js"
  }
}
```

- **`pnpm dev`** → Runs the worker in development mode.
- **`pnpm build`** → Compiles the project to JavaScript.
- **`pnpm start`** → Runs the compiled worker.

---

## 📝 License
This project is open-source and available under the [MIT License](LICENSE).

---

## 💡 Contributions
Feel free to fork this project and submit pull requests! 🎉
