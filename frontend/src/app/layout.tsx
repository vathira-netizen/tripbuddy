import type { Metadata } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import Image from "next/image";
import { Toaster } from "sonner";
import "./globals.css";
import { Nav } from "@/components/Nav";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
});

const dmSerif = DM_Serif_Display({
  variable: "--font-dm-serif",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TripBuddy",
  description: "Budget-first travel planning: discover, match, and plan together.",
  icons: {
    icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Toaster richColors position="top-center" toastOptions={{ className: "print:hidden" }} />
        <Nav />
        {children}
        <footer className="mt-auto brand-teal text-white/80 print:hidden">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-6 text-sm sm:flex-row sm:items-center sm:justify-between">
            <Image
              src="/brand/logo-horizontal-reversed.svg"
              alt="TripBuddy"
              width={150}
              height={24}
              className="h-6 w-auto"
            />
            <span>Budget-first travel planning · plan · match · explore together</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
