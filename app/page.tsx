'use client';

export default function HomePage() {
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column',
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      gap: '2rem'
    }}>
      <h1 style={{ fontSize: '2.5rem', fontWeight: '600', margin: 0 }}>Image Upload & Gallery</h1>
      <div style={{ display: 'flex', gap: '1rem' }}>
        <a
          href="/upload"
          style={{
            padding: '1rem 2rem',
            background: '#3b82f6',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '8px',
            fontSize: '1.1rem',
            fontWeight: '500',
          }}
        >
          Upload Images
        </a>
        <a
          href="/images"
          style={{
            padding: '1rem 2rem',
            background: '#10b981',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '8px',
            fontSize: '1.1rem',
            fontWeight: '500',
          }}
        >
          View All Images
        </a>
      </div>
    </div>
  );
}

