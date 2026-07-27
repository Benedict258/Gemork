import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const TOKEN_PATH = join(process.cwd(), ".relay-token");

export function getOrCreateToken(): string {
  if (existsSync(TOKEN_PATH)) {
    return readFileSync(TOKEN_PATH, "utf-8").trim();
  }
  const token = crypto.randomUUID();
  writeFileSync(TOKEN_PATH, token, "utf-8");
  return token;
}

export function validateToken(token: string | null, validToken: string): boolean {
  if (!token) return false;
  return token === validToken;
}
