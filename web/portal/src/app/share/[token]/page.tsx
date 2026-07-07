import { DashboardShell } from "../../../lib/dashboard-shell";
import { adminFixture } from "../../../lib/fixtures";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <DashboardShell initialState={adminFixture} initialShareToken={token} />;
}
