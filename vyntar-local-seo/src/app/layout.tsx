import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VYNTAR Local SEO - AI-Powered Citation Management for UK Agencies',
  description: 'Automate local SEO citation building across 60+ UK directories. AI-powered NAP consistency, citation audits, and white-label reporting for agencies.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans">{children}</body>
    </html>
  );
}
