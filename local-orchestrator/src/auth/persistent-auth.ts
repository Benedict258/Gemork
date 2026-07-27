import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

interface AuthFile {
  apiKey: string;
  createdAt: string;
}

export function generateApiKey(): string {
  return randomBytes(16).toString("hex");
}

export function loadOrGenerateApiKey(projectDir?: string): string {
  const gemorkDir = join(projectDir ?? process.cwd(), ".gemork");
  const authFilePath = join(gemorkDir, "auth.json");

  if (existsSync(authFilePath)) {
    try {
      const raw = readFileSync(authFilePath, "utf-8");
      const data: AuthFile = JSON.parse(raw);
      if (data.apiKey && typeof data.apiKey === "string") {
        return data.apiKey;
      }
    } catch {
      // Corrupted file — fall through to regenerate
    }
  }

  const apiKey = generateApiKey();
  if (!existsSync(gemorkDir)) {
    mkdirSync(gemorkDir, { recursive: true });
  }
  const authData: AuthFile = {
    apiKey,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(authFilePath, JSON.stringify(authData, null, 2));
  return apiKey;
}

export function createAuthMiddleware(apiKey: string) {
  return (req: any, res: any, next: any) => {
    if (req.path === "/health") return next();
    const key = req.headers["x-api-key"] || req.query.key;
    if (key !== apiKey) {
      return res.status(401).json({ error: "Unauthorized. Provide X-API-Key header." });
    }
    next();
  };
}

export function verifyWsApiKey(url: string, apiKey: string): boolean {
  try {
    const parsed = new URL(url);
    const key = parsed.searchParams.get("key");
    return key === apiKey;
  } catch {
    return false;
  }
}
