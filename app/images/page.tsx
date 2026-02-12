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
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

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
            // Prefer explicit productImageUrl (metadata mode), then url (blob mode)
            const imageUrl: string =
              (item.productImageUrl as string | undefined) ||
              (item.url as string | undefined) ||
              '';

            // Use filename from API response, or extract from image URL as fallback
            const filename: string =
              (item.filename as string | undefined) ||
              (imageUrl ? imageUrl.split('/').pop()?.split('?')[0] || '' : '');

            return {
              url: imageUrl,
              filename,
              title: (item.title as string | undefined) || filename,
              description: (item.description as string | undefined) || '',
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

  const handleDelete = async (filename: string) => {
    if (!confirm('Are you sure you want to delete this image?')) {
      return;
    }

    setDeleting(filename);
    try {
      const response = await fetch(`/api/images/${filename}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        // Remove from local state
        setImages(prev => prev.filter(img => img.filename !== filename));
        setSelectedImages(prev => {
          const newSet = new Set(prev);
          newSet.delete(filename);
          return newSet;
        });
        setError(null);
      } else {
        setError(data.error || 'Failed to delete image');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleSelect = (filename: string) => {
    setSelectedImages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filename)) {
        newSet.delete(filename);
      } else {
        newSet.add(filename);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedImages.size === images.length) {
      setSelectedImages(new Set());
    } else {
      setSelectedImages(new Set(images.map(img => img.filename)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedImages.size === 0) {
      setError('Please select at least one image to delete.');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedImages.size} image(s)?`)) {
      return;
    }

    setBulkDeleting(true);
    setError(null);

    const filenames = Array.from(selectedImages);
    const deletePromises = filenames.map(filename =>
      fetch(`/api/images/${filename}`, {
        method: 'DELETE',
      }).then(res => res.json())
    );

    try {
      const results = await Promise.all(deletePromises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      if (successful.length > 0) {
        // Remove successfully deleted images from state
        setImages(prev => prev.filter(img => !selectedImages.has(img.filename)));
        setSelectedImages(new Set());
      }

      if (failed.length > 0) {
        setError(`Failed to delete ${failed.length} image(s).`);
      } else {
        setError(null);
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: '600', margin: 0 }}>All Images ({images.length})</h1>
          {selectedImages.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                {selectedImages.size} selected
              </span>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                style={{
                  padding: '0.5rem 1rem',
                  background: bulkDeleting ? '#9ca3af' : '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: bulkDeleting ? 'not-allowed' : 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                }}
              >
                {bulkDeleting ? 'Deleting...' : `Delete Selected (${selectedImages.size})`}
              </button>
              <button
                onClick={() => setSelectedImages(new Set())}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#6b7280',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                }}
              >
                Clear Selection
              </button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={handleSelectAll}
            style={{
              padding: '0.5rem 1rem',
              background: selectedImages.size === images.length ? '#10b981' : '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            {selectedImages.size === images.length ? 'Deselect All' : 'Select All'}
          </button>
          <button
            onClick={fetchImages}
            style={{
              padding: '0.5rem 1rem',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
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
                border: selectedImages.has(image.filename) ? '2px solid #3b82f6' : '1px solid #e0e0e0',
                borderRadius: '8px',
                overflow: 'hidden',
                background: selectedImages.has(image.filename) ? '#eff6ff' : 'white',
                boxShadow: selectedImages.has(image.filename) ? '0 4px 8px rgba(59, 130, 246, 0.2)' : '0 2px 4px rgba(0,0,0,0.1)',
                position: 'relative',
              }}
            >
              <div style={{ position: 'absolute', top: '0.5rem', left: '0.5rem', zIndex: 10 }}>
                <input
                  type="checkbox"
                  checked={selectedImages.has(image.filename)}
                  onChange={() => handleToggleSelect(image.filename)}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: '1.25rem',
                    height: '1.25rem',
                    cursor: 'pointer',
                  }}
                />
              </div>
              <a
                href={`/images/${image.filename}`}
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <div style={{ position: 'relative', width: '100%', paddingTop: '75%', background: '#f3f4f6', cursor: 'pointer' }}>
                  <img
                    src={(image.url && image.url.trim() && image.url.includes('/')) ? image.url : `/api/images/${encodeURIComponent(image.filename)}`}
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
                      const target = e.target as HTMLImageElement;
                      const apiUrl = `/api/images/${encodeURIComponent(image.filename)}`;
                      // Try fallback to API endpoint if current URL fails
                      if (target.src !== apiUrl && !target.dataset.fallbackTried) {
                        target.dataset.fallbackTried = 'true';
                        console.log('Image load error, trying API URL:', apiUrl);
                        target.src = apiUrl;
                      } else {
                        // Both URLs failed - show placeholder
                        console.error('Both image URLs failed for:', image.filename);
                        target.style.display = 'none';
                        const parent = target.parentElement;
                        if (parent) {
                          parent.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #9ca3af; font-size: 0.875rem;">Image not available</div>';
                        }
                      }
                    }}
                    onLoad={() => {
                      console.log('Image loaded successfully:', image.filename);
                    }}
                    loading="lazy"
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
                <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
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
                    href={`/api/images/${encodeURIComponent(encodeURIComponent(image.filename))}`}
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
                  <span style={{ color: '#d1d5db' }}>|</span>
                  <button
                    onClick={() => handleDelete(image.filename)}
                    disabled={deleting === image.filename}
                    style={{
                      fontSize: '0.875rem',
                      color: '#ef4444',
                      background: 'none',
                      border: 'none',
                      cursor: deleting === image.filename ? 'not-allowed' : 'pointer',
                      padding: 0,
                      textDecoration: deleting === image.filename ? 'none' : 'underline',
                      opacity: deleting === image.filename ? 0.6 : 1,
                    }}
                  >
                    {deleting === image.filename ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

