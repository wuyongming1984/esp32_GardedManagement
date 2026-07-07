import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const PASSWORD_ROUNDS = 10;

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, PASSWORD_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  return bcrypt.compareSync(password, passwordHash);
}

export function createOpaqueToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
