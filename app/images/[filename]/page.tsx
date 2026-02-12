'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface ImageInfo {
  filename: string;
  url: string;
  apiUrl: string;
  title: string;
  description: string;
  size: number | null;
  uploadedAt: string | null;
  contentType: string | null;
  productUrl?: string | null;
}

export default function ImageViewPage() {
  const params = useParams();
  const router = useRouter();
  const rawParam = params.filename as string;
  // Normalize filename: decode URI components and convert spaces back to '+'
  // This fixes cases where '+' in filenames get turned into spaces in the route.
  const filename = decodeURIComponent(rawParam).replace(/ /g, '+');
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allImages, setAllImages] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

  useEffect(() => {
    const fetchImageData = async () => {
      try {
        setLoading(true);
        
        const response = await fetch('/api/images');
        const data = await response.json();

        if (response.ok) {
          // Handle new JSON format with images array of objects
          const imageData = data.images.map((item: any) => {
            if (typeof item === 'string') {
              const extractedFilename = item.split('/').pop() || '';
              return {
                filename: extractedFilename,
                url: item,
                title: extractedFilename,
                description: '',
                size: null,
                uploadedAt: null,
                contentType: null,
                productUrl: null,
              };
            }

            // Prefer explicit productImageUrl (metadata mode), then url (blob mode)
            const imageUrl: string =
              (item.productImageUrl as string | undefined) ||
              (item.url as string | undefined) ||
              '';

            // Use filename from API response, or extract from image URL as fallback
            let extractedFilename: string =
              (item.filename as string | undefined) ||
              (imageUrl ? imageUrl.split('/').pop()?.split('?')[0] || '' : '');

            if (!extractedFilename && imageUrl.includes('blob.vercel-storage.com')) {
              const urlParts = imageUrl.split('/');
              extractedFilename = urlParts[urlParts.length - 1]?.split('?')[0] || '';
            }

            return {
              filename: extractedFilename,
              url: imageUrl,
              title: (item.title as string | undefined) || extractedFilename,
              description: (item.description as string | undefined) || '',
              size: item.size || null,
              uploadedAt: item.uploadedAt || null,
              contentType: item.contentType || null,
              productUrl: (item.productUrl as string | undefined) || null,
            };
          });
          
          // Store full URLs for navigation
          setAllImages(imageData.map((img: { filename: string; url: string }) => img.filename));
          
          // Find matching image - check both exact match and partial match
          const matchedImage = imageData.find((img: { filename: string; url: string }) => {
            const imgBaseName = img.filename.split('.')[0];
            const paramBaseName = filename.split('.')[0];
            return img.filename === filename || 
                   img.filename.includes(filename) || 
                   filename.includes(imgBaseName) ||
                   imgBaseName === paramBaseName;
          });
          
        if (!matchedImage) {
          // Fallback: image might exist on disk even if it's not in /api/images list
          const fallbackApiUrl = `/api/images/${encodeURIComponent(encodeURIComponent(filename))}`;
          setImageInfo({
            filename: filename,
            url: fallbackApiUrl,
            apiUrl: fallbackApiUrl,
            title: '',
            description: '',
            size: null,
            uploadedAt: null,
            contentType: null,
            productUrl: null,
          });
          setCurrentIndex(-1);
          setError(null);
          return;
        }
          
          const index = imageData.findIndex((img: any) => img.filename === matchedImage.filename);
          setCurrentIndex(index >= 0 ? index : 0);

          // If we have an external image URL (from metadata), use it directly.
          // Otherwise, fall back to our internal API route.
          const apiUrl =
            matchedImage.url && matchedImage.url.startsWith('http') && !matchedImage.url.includes('/api/images/')
              ? matchedImage.url
              : `/api/images/${encodeURIComponent(encodeURIComponent(matchedImage.filename))}`;

          setImageInfo({
            filename: matchedImage.filename,
            url: matchedImage.url,
            apiUrl: apiUrl,
            title: matchedImage.title || '',
            description: matchedImage.description || '',
            size: matchedImage.size || null,
            uploadedAt: matchedImage.uploadedAt || null,
            contentType: matchedImage.contentType || null,
            productUrl: (matchedImage as any).productUrl || null,
          });
          console.log('Image info set:', {
            filename: matchedImage.filename,
            url: matchedImage.url,
            apiUrl: apiUrl
          });
          setError(null);
        } else {
          setError(data.error || 'Failed to fetch image data');
        }
      } catch (err) {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    if (filename) {
      fetchImageData();
    }
  }, [filename]);

  const navigateImage = (direction: 'prev' | 'next') => {
    if (allImages.length === 0 || currentIndex === -1) return;
    
    let newIndex: number;
    if (direction === 'prev') {
      newIndex = currentIndex === 0 ? allImages.length - 1 : currentIndex - 1;
    } else {
      newIndex = currentIndex === allImages.length - 1 ? 0 : currentIndex + 1;
    }
    
    router.push(`/images/${allImages[newIndex]}`);
  };

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontSize: '1.2rem'
      }}>
        Loading image...
      </div>
    );
  }

  if (error || !imageInfo) {
    return (
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
        <div
          style={{
            padding: '1rem',
            background: '#fee2e2',
            color: '#991b1b',
            borderRadius: '4px',
            marginBottom: '1rem',
          }}
        >
          {error || 'Image not found'}
        </div>
        <a
          href="/images"
          style={{
            padding: '0.5rem 1rem',
            background: '#3b82f6',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '4px',
          }}
        >
          Back to Gallery
        </a>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a
          href="/images"
          style={{
            padding: '0.5rem 1rem',
            background: '#6b7280',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '4px',
            fontSize: '0.875rem',
          }}
        >
          ← Back to Gallery
        </a>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {allImages.length > 1 && (
            <>
              <button
                onClick={() => navigateImage('prev')}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                ← Previous
              </button>
              <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                {currentIndex + 1} / {allImages.length}
              </span>
              <button
                onClick={() => navigateImage('next')}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Next →
              </button>
            </>
          )}
        </div>
      </div>

      <div
        style={{
          background: 'white',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          padding: '1.5rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}
      >
        <h2
          style={{
            fontSize: '1.25rem',
            fontWeight: '600',
            marginBottom: '1rem',
            wordBreak: 'break-all',
          }}
        >
          {imageInfo.filename}
        </h2>

        <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
          <img
            src={imageInfo.apiUrl}
            alt={imageInfo.filename}
            style={{
              maxWidth: '100%',
              height: 'auto',
              borderRadius: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              console.error('Image load error:', {
                currentSrc: target.currentSrc,
                apiUrl: imageInfo.apiUrl,
                blobUrl: imageInfo.url,
                filename: imageInfo.filename
              });
              
              // Try fallback to blob URL if API URL fails
              if (imageInfo.url && imageInfo.url !== imageInfo.apiUrl && !target.dataset.fallbackTried) {
                target.dataset.fallbackTried = 'true';
                console.log('Trying fallback blob URL:', imageInfo.url);
                target.src = imageInfo.url;
              } else {
                // Both URLs failed - show error with helpful message
                console.error('Both image URLs failed to load');
                setError(`Failed to load image: ${imageInfo.filename}. Please check if the file exists.`);
              }
            }}
            onLoad={() => {
              console.log('Image loaded successfully from:', imageInfo.apiUrl);
            }}
          />
        </div>

        <div
          style={{
            padding: '1rem',
            background: '#f9fafb',
            borderRadius: '4px',
            border: '1px solid #e5e7eb',
          }}
        >
          <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '0.75rem' }}>
            API Information
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <strong style={{ fontSize: '0.875rem', color: '#6b7280' }}>API URL:</strong>
              <div
                style={{
                  marginTop: '0.25rem',
                  padding: '0.5rem',
                  background: 'white',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  wordBreak: 'break-all',
                }}
              >
                {imageInfo.apiUrl}
              </div>
            </div>

            <div>
              <strong style={{ fontSize: '0.875rem', color: '#6b7280' }}>Filename:</strong>
              <div
                style={{
                  marginTop: '0.25rem',
                  padding: '0.5rem',
                  background: 'white',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  wordBreak: 'break-all',
                }}
              >
                {imageInfo.filename}
              </div>
            </div>

            {imageInfo.productUrl && (
              <div>
                <strong style={{ fontSize: '0.875rem', color: '#6b7280' }}>Product URL:</strong>
                <div
                  style={{
                    marginTop: '0.25rem',
                    padding: '0.5rem',
                    background: 'white',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    fontSize: '0.875rem',
                    wordBreak: 'break-all',
                  }}
                >
                  <a
                    href={imageInfo.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#2563eb', textDecoration: 'none' }}
                  >
                    {imageInfo.productUrl}
                  </a>
                </div>
              </div>
            )}

            <div style={{ marginTop: '0.5rem' }}>
              <a
                href={imageInfo.apiUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  padding: '0.5rem 1rem',
                  background: '#10b981',
                  color: 'white',
                  textDecoration: 'none',
                  borderRadius: '4px',
                  fontSize: '0.875rem',
                }}
              >
                Open Image in New Tab
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

