import { promises as fs } from "fs";
import path from "path";

export type Status = "active" | "inactive" | "disabled";
export type Health = "up" | "down" | "unknown";
export type Site = {
  id: string;
  name: string;
  url: string;
  status: Status;
  health: Health;
  lastCheck?: number;
  lastMs?: number;
  lastCode?: number;
  lastError?: string;
  lastWarning?: string;
  lastDetail?: string;
  okCodes?: string;
  ignoreCert?: boolean;
  downSince?: number;
  createdAt: number;
};
export type Check = {
  siteId: string;
  ts: number;
  ok: boolean;
  code: number;
  ms: number;
  error?: string;
  warning?: string;
  detail?: string;
};
type DB = { sites: Site[]; checks: Check[] };

const FILE = path.join(process.cwd(), "data", "db.json");

export async function readDB(): Promise<DB> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return { sites: [], checks: [] };
  }
}
export async function writeDB(db: DB) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(db));
  await fs.rename(tmp, FILE);
}
