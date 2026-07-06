import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "苗圃智能控制中心",
  description: "ESP32-P4 苗圃远程监控与浇灌管理平台"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
