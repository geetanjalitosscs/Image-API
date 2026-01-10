import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Image Upload',
  description: 'Image upload and retrieval application',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Suppress inject.js errors from browser extensions
              window.addEventListener('error', function(e) {
                if (e.message && e.message.includes('inject.js')) {
                  e.preventDefault();
                  return false;
                }
              }, true);
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}

