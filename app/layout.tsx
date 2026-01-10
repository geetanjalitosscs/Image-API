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
      <body>{children}</body>
    </html>
  )
}

