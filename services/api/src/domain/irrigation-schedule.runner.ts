import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { appState } from "../app-state.js";

@Injectable()
export class IrrigationScheduleRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IrrigationScheduleRunner.name);
  private timer?: NodeJS.Timeout;

  onModuleInit() {
    this.timer = setInterval(() => {
      const ran = appState.schedules.processDue();
      if (ran.length > 0) {
        this.logger.log(`processed ${ran.length} irrigation schedule(s)`);
      }
    }, 10_000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
