import { DashboardShell } from "../lib/dashboard-shell";
import { adminFixture } from "../lib/fixtures";

export default function Home() {
  return <DashboardShell initialState={adminFixture} />;
}
