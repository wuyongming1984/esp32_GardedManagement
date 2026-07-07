import { createSeededNurseryDomain } from "./domain/seed.js";
import { DeviceService } from "./domain/device.service.js";
import { IrrigationCommandService } from "./domain/irrigation-command.service.js";
import { IrrigationScheduleService } from "./domain/irrigation-schedule.service.js";
import { ShareLinkService } from "./domain/share-link.service.js";
import { VideoSessionService } from "./domain/video-session.service.js";
import { hashPassword, verifyPassword } from "./auth/security.js";

const domain = createSeededNurseryDomain();

export const appState = {
  store: domain.store,
  devices: new DeviceService(domain.store),
  irrigation: new IrrigationCommandService(domain.store),
  schedules: new IrrigationScheduleService(domain.store),
  shareLinks: new ShareLinkService(domain.store),
  video: new VideoSessionService(domain.store),
  auth: {
    hashPassword,
    verifyPassword
  }
};
