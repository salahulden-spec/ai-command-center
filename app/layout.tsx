import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/app/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Command Center",
  description: "Personal AI operating system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col relative">
        <div
          aria-hidden
          className="bg-grid pointer-events-none fixed inset-0 -z-10 [mask-image:radial-gradient(ellipse_80%_60%_at_50%_-10%,black,transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none fixed left-1/2 top-[-10rem] -z-10 h-[30rem] w-[60rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]"
        />
        <Providers>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
