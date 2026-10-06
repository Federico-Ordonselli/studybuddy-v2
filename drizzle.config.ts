import { existsSync } from "node:fs";
import type { Config } from "drizzle-kit";

// stesso DB dell'app: Next legge .env.local da solo, drizzle-kit no
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: process.env.DB_PATH ?? "studybuddy.db" },
} satisfies Config;
