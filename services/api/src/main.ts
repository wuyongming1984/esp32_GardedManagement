import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix("api", { exclude: ["me", "me/password", "auth/login", "auth/share-links/:token/exchange"] });
  const port = Number(process.env.PORT ?? "3001");
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
