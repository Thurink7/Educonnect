import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Educonnect | Gestão educacional",
  description: "Acompanhe frequência, aulas e engajamento escolar em um só lugar."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body suppressHydrationWarning>{children}</body></html>;
}
