'use client';

import { useState, useRef } from 'react';

export default function UploadPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
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

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: `Successfully uploaded ${data.uploaded} image(s).` });
        setFiles([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
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
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          multiple
          onChange={handleFileChange}
          style={{ marginBottom: '1rem' }}
        />
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

      <button
        onClick={handleUpload}
        disabled={uploading || files.length === 0}
        style={{
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

