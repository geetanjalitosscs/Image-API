import { NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { list } from '@vercel/blob';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const IS_VERCEL = process.env.VERCEL === '1';

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

function isValidImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

export async function GET() {
  try {
    if (IS_VERCEL) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        console.warn('BLOB_READ_WRITE_TOKEN not configured, returning empty list');
        return NextResponse.json({ 
          success: true,
          count: 0,
          images: [] 
        });
      }
      try {
        const { blobs } = await list();
        console.log('Total blobs found:', blobs.length);
        console.log('Blob samples:', blobs.slice(0, 3).map(b => ({ pathname: b.pathname, url: b.url })));
        
        const imageFiles = blobs
          .filter(blob => {
            const ext = path.extname(blob.pathname).toLowerCase();
            return ALLOWED_EXTENSIONS.includes(ext);
          })
          .map(blob => {
            // Extract filename from pathname (handle both /filename and filename formats)
            const filename = blob.pathname.split('/').pop() || blob.pathname;
            // Return complete image data
            return {
              filename: filename,
              apiUrl: `/api/images/${filename}`,
              directUrl: blob.url,
              pathname: blob.pathname,
              size: blob.size || null,
              uploadedAt: blob.uploadedAt || null,
              contentType: blob.contentType || null
            };
          })
          .sort((a, b) => a.filename.localeCompare(b.filename));
        
        console.log('Image files:', imageFiles);
        return NextResponse.json({ 
          success: true,
          count: imageFiles.length,
          images: imageFiles
        });
      } catch (error) {
        console.error('Error listing blobs:', error);
        return NextResponse.json({ 
          success: false,
          count: 0,
          images: [],
          error: 'Failed to list images'
        });
      }
    } else {
      if (!existsSync(UPLOAD_DIR)) {
        return NextResponse.json({ 
          success: true,
          count: 0,
          images: [] 
        });
      }

      const files = await readdir(UPLOAD_DIR);
      const imageFiles = files
        .filter(file => isValidImageFile(file))
        .map(file => {
          const filePath = path.join(UPLOAD_DIR, file);
          const stats = existsSync(filePath) ? require('fs').statSync(filePath) : null;
          return {
            filename: file,
            apiUrl: `/api/images/${file}`,
            directUrl: `/api/images/${file}`,
            pathname: `/uploads/${file}`,
            size: stats ? stats.size : null,
            uploadedAt: stats ? stats.mtime.toISOString() : null,
            contentType: null
          };
        })
        .sort((a, b) => a.filename.localeCompare(b.filename));

      return NextResponse.json({ 
        success: true,
        count: imageFiles.length,
        images: imageFiles
      });
    }
  } catch (error) {
    console.error('Error reading images:', error);
    return NextResponse.json(
      { error: 'Failed to fetch images' },
      { status: 500 }
    );
  }
}
