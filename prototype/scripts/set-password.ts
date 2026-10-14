import "./env";
import fs from "node:fs";
import path from "node:path";
import { DERIVED_DIR } from "../src/lib/config";
import { hashPassword } from "../src/lib/auth/users";

// Set a specific password for one account:  npx tsx scripts/set-password.ts <username> <password>
const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error("Usage: npx tsx scripts/set-password.ts <username> <password>");
  process.exit(1);
}
const p = path.join(DERIVED_DIR, "users.json");
const data = JSON.parse(fs.readFileSync(p, "utf8"));
const u = data.users.find((x: { username: string }) => x.username === username.toLowerCase());
if (!u) {
  console.error(`No user "${username}"`);
  process.exit(1);
}
Object.assign(u, hashPassword(password));
fs.writeFileSync(p, JSON.stringify(data, null, 2));
console.log(`Password updated for ${username}.`);
