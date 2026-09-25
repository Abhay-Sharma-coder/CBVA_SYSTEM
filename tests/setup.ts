import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) {
  throw new Error(
    "Integration tests need a database. Copy .env.example to .env.local and fill it in.",
  );
}
