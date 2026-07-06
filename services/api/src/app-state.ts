import { createSeededNurseryDomain } from "./domain/seed.js";
import { DeviceService } from "./domain/device.service.js";
import { IrrigationCommandService } from "./domain/irrigation-command.service.js";
import { VideoSessionService } from "./domain/video-session.service.js";

const domain = createSeededNurseryDomain();

export const appState = {
  store: domain.store,
  devices: new DeviceService(domain.store),
  irrigation: new IrrigationCommandService(domain.store),
  video: new VideoSessionService(domain.store)
};
