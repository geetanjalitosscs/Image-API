'use client';

import { useState, useEffect } from 'react';

interface ImageData {
  url: string;
  filename: string;
  title: string;
  description: string;
}

export default function ImagesPage() {
  const [images, setImages] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchImages = async () => {
    try {
      setLoading(true);
      // Add cache busting to get fresh data
      const response = await fetch('/api/images', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      const data = await response.json();

      if (response.ok) {
        // Handle new JSON format with images array
        let imageData: ImageData[];
        if (data.images && Array.isArray(data.images)) {
          imageData = data.images.map((item: any) => {
            // Use filename from API response, or extract from URL as fallback
            const filename = item.filename || (item.url ? item.url.split('/').pop()?.split('?')[0] || '' : '');
            return {
              url: item.url || '',
              filename: filename,
              title: item.title || '',
              description: item.description || '',
            };
          });
        } else {
          // Fallback for old format
          imageData = (data.images || []).map((url: string) => {
            const filename = url.split('/').pop() || '';
            return {
              url: `/api/images/${filename}`,
              filename: filename,
              title: '',
              description: '',
            };
          });
        }
        setImages(imageData);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch images');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, []);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: '600' }}>All Images ({images.length})</h1>
        <div>
          <button
            onClick={fetchImages}
            style={{
              padding: '0.5rem 1rem',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginRight: '0.5rem',
            }}
          >
            Refresh
          </button>
          <a
            href="/upload"
            style={{
              padding: '0.5rem 1rem',
              background: '#10b981',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
              display: 'inline-block',
            }}
          >
            Upload More
          </a>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem', fontSize: '1.2rem' }}>
          Loading images...
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '1rem',
            background: '#fee2e2',
            color: '#991b1b',
            borderRadius: '4px',
            marginBottom: '1rem',
          }}
        >
          {error}
        </div>
      )}

      {!loading && !error && images.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem', fontSize: '1.2rem', color: '#6b7280' }}>
          No images found. <a href="/upload" style={{ color: '#3b82f6' }}>Upload some images</a>
        </div>
      )}

      {!loading && images.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {images.map((image, index) => (
            <div
              key={index}
              style={{
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                overflow: 'hidden',
                background: 'white',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              }}
            >
              <a
                href={`/images/${image.filename}`}
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <div style={{ position: 'relative', width: '100%', paddingTop: '75%', background: '#f3f4f6', cursor: 'pointer' }}>
                  <img
                    src={image.url}
                    alt={image.filename}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/placeholder.png';
                    }}
                  />
                </div>
              </a>
              <div style={{ padding: '0.75rem' }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.875rem',
                    color: '#6b7280',
                    wordBreak: 'break-all',
                  }}
                  title={image.filename}
                >
                  {image.filename.length > 30
                    ? `${image.filename.substring(0, 30)}...`
                    : image.filename}
                </p>
                <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                  <a
                    href={`/images/${image.filename}`}
                    style={{
                      fontSize: '0.875rem',
                      color: '#3b82f6',
                      textDecoration: 'none',
                    }}
                  >
                    View Details
                  </a>
                  <span style={{ color: '#d1d5db' }}>|</span>
                  <a
                    href={image.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: '0.875rem',
                      color: '#3b82f6',
                      textDecoration: 'none',
                    }}
                  >
                    Direct Link
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

