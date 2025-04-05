🚀 Solix Worker

Solix Worker is a **Redis-based job queue processor** using **Bull** and **Upstash Redis**. It efficiently processes webhook jobs in the background.

---

## 📂 Project Structure
```
solix-worker/
│── src/
│   ├── lib/
│   │   ├── processData.ts   # Function to process job data
│   ├── worker.ts            # Main worker file
│── .env                     # Environment variables
│── package.json             # Dependencies & scripts
│── tsconfig.json            # TypeScript configuration
│── vercel.json              # Deployment config
│── README.md                # Documentation
```

---

## 🛠 Installation & Setup

### 1️⃣ Clone the Repository
```sh
git clone https://github.com/your-repo/solix-worker.git
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
REDIS_URL=your_upstash_redis_url
REDIS_QUEUE_NAME=webhookQueue
ENCRYPTION_KEY=your_encryption_key
ENCRYPTION_IV=your_encryption_iv
DATABASE_URL=your_database_url
NODE_ENV=development
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

## 🚀 Deployment
### **Deploy on Vercel**
Create a `vercel.json` file:

```json
{
  "version": 2,
  "builds": [{ "src": "src/worker.ts", "use": "@vercel/node" }],
  "routes": [{ "src": "/.*", "dest": "src/worker.ts" }]
}
```

Run:
```sh
vercel deploy
```

---

## 📝 License
This project is open-source and available under the [MIT License](LICENSE).

---

## 💡 Contributions
Feel free to fork this project and submit pull requests! 🎉
