import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "./auth-provider";

export const metadata: Metadata = {
  title: "Beforest AI",
  description: "Secure organizational knowledge, grounded answers, and external research.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
