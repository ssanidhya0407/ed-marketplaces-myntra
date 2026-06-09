import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { NotificationProvider } from '@/components/NotificationProvider';
import Shell from '@/components/Shell';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Myntra OMS',
  description: 'Order management for Myntra Seller — EXPERIENCES.DIGITAL',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <NotificationProvider>
          <Shell>{children}</Shell>
        </NotificationProvider>
      </body>
    </html>
  );
}
