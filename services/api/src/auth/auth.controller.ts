import { Body, Controller, Get, Headers, Post, UnauthorizedException } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { appState } from "../app-state.js";

const jwtSecret = process.env.JWT_SECRET ?? "dev-only-change-me";

interface LoginBody {
  email: string;
}

function publicUser(userId: string) {
  const user = appState.store.users.get(userId);
  if (!user) {
    throw new UnauthorizedException("Unknown user");
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    customerId: user.customerId
  };
}

export function actorFromAuthorizationHeader(authorization?: string): string {
  if (!authorization) {
    return "user-admin";
  }
  const token = authorization.replace(/^Bearer\s+/i, "");
  const decoded = jwt.verify(token, jwtSecret) as { sub: string };
  return decoded.sub;
}

@Controller()
export class AuthController {
  @Post("auth/login")
  login(@Body() body: LoginBody) {
    const user = Array.from(appState.store.users.values()).find((candidate) => candidate.email === body.email);
    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }
    return {
      accessToken: jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: "8h" }),
      user: publicUser(user.id)
    };
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return publicUser(actorFromAuthorizationHeader(authorization));
  }
}
