'use client';

import { useState, useRef } from 'react';

export default function UploadPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [productUrl, setProductUrl] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      const imageFiles = selectedFiles.filter(file => {
        const type = file.type.toLowerCase();
        return type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png' || type === 'image/webp';
      });

      if (imageFiles.length !== selectedFiles.length) {
        setMessage({ type: 'error', text: 'Some files were not images. Only JPG, PNG, and WEBP are allowed.' });
      }

      setFiles(prev => [...prev, ...imageFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleExtractUrl = async () => {
    if (!productUrl.trim()) {
      setMessage({ type: 'error', text: 'Please enter a product URL.' });
      return;
    }

    setExtracting(true);
    setMessage(null);

    try {
      if (!productUrl || !productUrl.trim()) {
        setMessage({ type: 'error', text: 'Please enter a product URL.' });
        setExtracting(false);
        return;
      }

      const response = await fetch('/api/extract-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ productUrl: productUrl.trim() }),
      });

      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        setMessage({ type: 'error', text: 'Invalid response from server. Please try again.' });
        setExtracting(false);
        return;
      }

      if (response.ok) {
        setMessage({ type: 'success', text: 'Product details extracted and image saved! Check gallery to see the product.' });
        setProductUrl('');
        // Redirect to gallery after successful extraction
        setTimeout(() => {
          window.location.href = '/images';
        }, 1500);
      } else {
        // Handle multi-line error messages from API
        let errorText = data.error || 'Failed to extract product details. Please check the URL and try again.';
        // If error contains newlines, format it better
        if (errorText.includes('\n')) {
          errorText = errorText.split('\n').join(' ');
        }
        setMessage({ type: 'error', text: errorText });
      }
    } catch (error: any) {
      console.error('Extract URL error:', error);
      setMessage({ type: 'error', text: error.message || 'Network error. Please check your connection and try again.' });
    } finally {
      setExtracting(false);
    }
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setMessage({ type: 'error', text: 'Please select at least one image.' });
      return;
    }

    setUploading(true);
    setMessage(null);

    const formData = new FormData();
    files.forEach(file => {
      formData.append('images', file);
    });
    
    // Add product URL if provided
    if (productUrl.trim()) {
      formData.append('productUrl', productUrl.trim());
    }

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: `Successfully uploaded ${data.uploaded} image(s).` });
        setFiles([]);
        setProductUrl('');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        // Redirect to gallery after successful upload
        setTimeout(() => {
          window.location.href = '/images';
        }, 1500);
      } else {
        const errorMsg = data.error || 'Upload failed.';
        const errorDetails = data.errors && data.errors.length > 0 
          ? ` ${data.errors.join('; ')}` 
          : '';
        console.error('Upload error:', errorMsg, errorDetails);
        setMessage({ type: 'error', text: errorMsg + errorDetails });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: '600', margin: 0 }}>Image Upload</h1>
        <a
          href="/images"
          style={{
            padding: '0.5rem 1rem',
            background: '#10b981',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '4px',
            fontSize: '0.875rem',
          }}
        >
          View All Images
        </a>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500', fontSize: '0.875rem' }}>
            Select Images
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            multiple
            onChange={handleFileChange}
            style={{ 
              width: '100%',
              padding: '0.5rem',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              fontSize: '0.875rem'
            }}
          />
        </div>
        
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500', fontSize: '0.875rem' }}>
            Product URL
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="url"
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
              placeholder="https://www.limeroad.com/..."
              style={{ 
                flex: 1,
                padding: '0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '0.875rem'
              }}
            />
            <button
              onClick={handleExtractUrl}
              disabled={extracting || !productUrl.trim()}
              style={{
                padding: '0.75rem 1.5rem',
                background: extracting || !productUrl.trim() ? '#9ca3af' : '#8b5cf6',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: extracting || !productUrl.trim() ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: '500',
                whiteSpace: 'nowrap'
              }}
            >
              {extracting ? 'Extracting...' : 'Extract Details'}
            </button>
          </div>
          <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>
            Paste a LimeRoad product URL and click "Extract Details" to get product information, or use it when uploading images
          </p>
        </div>
      </div>

      {files.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Selected Files ({files.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {files.map((file, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.75rem',
                  border: '1px solid #e0e0e0',
                  borderRadius: '4px',
                }}
              >
                <span>{file.name} ({(file.size / 1024).toFixed(2)} KB)</span>
                <button
                  onClick={() => removeFile(index)}
                  style={{
                    padding: '0.25rem 0.75rem',
                    background: '#ef4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}


      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button
          onClick={handleUpload}
          disabled={uploading || files.length === 0}
          style={{
            flex: 1,
            padding: '0.75rem 1.5rem',
            background: uploading || files.length === 0 ? '#9ca3af' : '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: uploading || files.length === 0 ? 'not-allowed' : 'pointer',
            fontSize: '1rem',
            fontWeight: '500',
          }}
        >
          {uploading ? 'Uploading...' : 'Upload Images'}
        </button>
      </div>

      {message && (
        <div
          style={{
            marginTop: '1rem',
            padding: '1rem',
            borderRadius: '4px',
            background: message.type === 'success' ? '#d1fae5' : '#fee2e2',
            color: message.type === 'success' ? '#065f46' : '#991b1b',
          }}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}

