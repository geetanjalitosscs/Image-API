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
              // Suppress errors from browser extensions
              (function() {
                var originalError = console.error;
                console.error = function() {
                  var args = Array.prototype.slice.call(arguments);
                  var errorMessage = args.join(' ');
                  // Suppress errors from browser extensions
                  if (errorMessage.includes('inject.js') || 
                      errorMessage.includes('chrome-extension://') ||
                      errorMessage.includes('moz-extension://') ||
                      errorMessage.includes('ReferenceError: e is not defined')) {
                    return;
                  }
                  originalError.apply(console, args);
                };
                
                // Suppress unhandled errors from extensions
                window.addEventListener('error', function(e) {
                  if (e.filename && (
                    e.filename.includes('inject.js') ||
                    e.filename.includes('chrome-extension://') ||
                    e.filename.includes('moz-extension://')
                  )) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                  }
                  // Also suppress "e is not defined" errors from extensions
                  if (e.message && (
                    e.message.includes('e is not defined') ||
                    e.message.includes('ReferenceError: e is not defined')
                  )) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                  }
                }, true);
                
                // Suppress unhandled promise rejections from extensions
                window.addEventListener('unhandledrejection', function(e) {
                  if (e.reason && (
                    String(e.reason).includes('inject.js') ||
                    String(e.reason).includes('chrome-extension://') ||
                    String(e.reason).includes('moz-extension://')
                  )) {
                    e.preventDefault();
                    return false;
                  }
                });
              })();
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}

