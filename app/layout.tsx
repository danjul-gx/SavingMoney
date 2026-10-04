import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

// ---------------------------------------------------------------------------
// Viewport config — separate export required for Next.js 14+
// Handles theme-color and iOS safe-area viewport settings.
// ---------------------------------------------------------------------------
export const viewport: Viewport = {
  themeColor: '#FA855A',
  width: 'device-width',
  initialScale: 1,
  // viewportFit=cover is critical for iOS notch / Dynamic Island / Home Indicator
  viewportFit: 'cover',
  // DO NOT set userScalable: false — accessibility requirement
}

// ---------------------------------------------------------------------------
// App metadata — covers iOS PWA meta tags via Next.js Metadata API
// ---------------------------------------------------------------------------
export const metadata: Metadata = {
  title: {
    default: 'Savings & Cashflow Tracker',
    template: '%s | Cashflow',
  },
  description:
    'Personal finance tracker. Pay Yourself First — track income, wallets, budget, and savings goals.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    // Enables fullscreen standalone mode on iOS Safari Add to Home Screen
    capable: true,
    title: 'Cashflow',
    // black-translucent: status bar overlaps content; app handles safe-area via CSS
    statusBarStyle: 'black-translucent',
  },
  icons: {
    apple: '/icons/apple-touch-icon.png',
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
  // Prevents phone-number auto-detection on iOS Safari
  formatDetection: {
    telephone: false,
  },
}

import { AuthProvider } from '@/lib/auth/context'
import { ThemeProvider } from '@/lib/theme/theme-context'

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="id"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('cashflow_theme_preference');if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.setAttribute('data-theme','dark');document.documentElement.style.colorScheme='dark';}else{document.documentElement.classList.remove('dark');document.documentElement.setAttribute('data-theme','light');document.documentElement.style.colorScheme='light';}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="app-root">
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}

