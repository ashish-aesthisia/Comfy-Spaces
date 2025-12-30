import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const theme = createTheme({
  colorScheme: 'dark',
  primaryColor: 'blue',
  colors: {
    blue: [
      '#e6f2ff',
      '#b3d9ff',
      '#80bfff',
      '#4da6ff',
      '#1a8cff',
      '#0070f3', // Vercel blue
      '#0052b3',
      '#003d80',
      '#00294d',
      '#00141a',
    ],
  },
  defaultRadius: 'md',
  fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
  headings: {
    fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
  },
});

export const metadata: Metadata = {
  title: "Comfy Spaces",
  description: "Manage and activate custom node revisions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <MantineProvider theme={theme}>
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
