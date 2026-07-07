import { Body, Controller, Get, Headers, Param, Patch, Post, UnauthorizedException } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { appState } from "../app-state.js";
import { ActorScope } from "../domain/types.js";

const jwtSecret = process.env.JWT_SECRET ?? "dev-only-change-me";

interface LoginBody {
  email: string;
  password: string;
}

export interface ActorContext {
  userId: string;
  scope: ActorScope;
  customerId?: string;
  deviceId?: string;
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
  return actorContextFromAuthorizationHeader(authorization).userId;
}

export function actorContextFromAuthorizationHeader(authorization?: string): ActorContext {
  if (!authorization) {
    throw new UnauthorizedException("Missing authorization token");
  }
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    throw new UnauthorizedException("Missing authorization token");
  }
  try {
    const decoded = jwt.verify(token, jwtSecret) as { sub: string; scope?: ActorScope; customerId?: string; deviceId?: string };
    return {
      userId: decoded.sub,
      scope: decoded.scope ?? "user",
      customerId: decoded.customerId,
      deviceId: decoded.deviceId
    };
  } catch {
    throw new UnauthorizedException("Invalid authorization token");
  }
}

@Controller()
export class AuthController {
  @Post("auth/login")
  login(@Body() body: LoginBody) {
    const user = Array.from(appState.store.users.values()).find((candidate) => candidate.email === body.email);
    if (!user || !body.password || !appState.auth.verifyPassword(body.password, user.passwordHash)) {
      throw new UnauthorizedException("Invalid credentials");
    }
    return {
      accessToken: jwt.sign({ sub: user.id, role: user.role, scope: "user" }, jwtSecret, { expiresIn: "8h" }),
      user: publicUser(user.id)
    };
  }

  @Post("auth/share-links/:token/exchange")
  exchangeShareLink(@Param("token") token: string) {
    try {
      const link = appState.shareLinks.exchange(token);
      const user = Array.from(appState.store.users.values()).find((candidate) => candidate.customerId === link.customerId);
      if (!user) {
        throw new UnauthorizedException("No customer user for share link");
      }
      return {
        accessToken: jwt.sign(
          { sub: user.id, role: user.role, scope: "share", customerId: link.customerId, deviceId: link.deviceId },
          jwtSecret,
          { expiresIn: "12h" }
        ),
        user: publicUser(user.id)
      };
    } catch {
      throw new UnauthorizedException("Invalid share link");
    }
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return publicUser(actorFromAuthorizationHeader(authorization));
  }

  @Patch("me")
  updateMe(@Body() body: { name?: string; email?: string }, @Headers("authorization") authorization?: string) {
    const user = appState.store.users.get(actorFromAuthorizationHeader(authorization));
    if (!user) {
      throw new UnauthorizedException("Unknown user");
    }
    if (body.name?.trim()) {
      user.name = body.name.trim();
    }
    if (body.email?.trim()) {
      const email = body.email.trim();
      const existing = Array.from(appState.store.users.values()).find((candidate) => candidate.email === email && candidate.id !== user.id);
      if (existing) {
        throw new UnauthorizedException("Email is already used");
      }
      user.email = email;
    }
    return publicUser(user.id);
  }

  @Post("me/password")
  changePassword(
    @Body() body: { currentPassword: string; newPassword: string },
    @Headers("authorization") authorization?: string
  ) {
    const user = appState.store.users.get(actorFromAuthorizationHeader(authorization));
    if (!user || !appState.auth.verifyPassword(body.currentPassword, user.passwordHash)) {
      throw new UnauthorizedException("Current password is incorrect");
    }
    if (!body.newPassword || body.newPassword.length < 8) {
      throw new UnauthorizedException("New password must be at least 8 characters");
    }
    user.passwordHash = appState.auth.hashPassword(body.newPassword);
    return { ok: true };
  }
}
