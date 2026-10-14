import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DERIVED_DIR } from "../config";
import type { Role } from "./session";

export interface UserRecord {
  username: string;
  name: string;
  title: string;
  role: Role;
  salt: string; // hex
  hash: string; // hex, scrypt(password, salt, 64)
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")): { salt: string; hash: string } {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

export function loadUsers(): UserRecord[] {
  const p = path.join(DERIVED_DIR, "users.json");
  if (!fs.existsSync(p)) return [];
  return (JSON.parse(fs.readFileSync(p, "utf8")) as { users: UserRecord[] }).users;
}

/** Constant-time password check. Unknown users still pay the hashing cost. */
export function verifyUser(username: string, password: string): UserRecord | null {
  const u = loadUsers().find((x) => x.username === username.trim().toLowerCase());
  const salt = u?.salt ?? "0".repeat(32);
  const expected = Buffer.from(u?.hash ?? "0".repeat(128), "hex");
  const actual = crypto.scryptSync(password, salt, 64);
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  return u && ok ? u : null;
}
