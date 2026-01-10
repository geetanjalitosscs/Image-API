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
        return NextResponse.json({ images: [] });
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
            // Return both API path and direct blob URL
            return {
              apiUrl: `/api/images/${filename}`,
              directUrl: blob.url,
              filename: filename
            };
          })
          .sort((a, b) => a.filename.localeCompare(b.filename));
        
        // Return both formats for compatibility
        return NextResponse.json({ 
          images: imageFiles.map(img => img.apiUrl),
          imagesWithUrls: imageFiles 
        });
        
        console.log('Image files:', imageFiles);
        return NextResponse.json({ images: imageFiles });
      } catch (error) {
        console.error('Error listing blobs:', error);
        return NextResponse.json({ images: [] });
      }
    } else {
      if (!existsSync(UPLOAD_DIR)) {
        return NextResponse.json({ images: [] });
      }

      const files = await readdir(UPLOAD_DIR);
      const imageFiles = files
        .filter(file => isValidImageFile(file))
        .map(file => `/api/images/${file}`)
        .sort();

      return NextResponse.json({ images: imageFiles });
    }
  } catch (error) {
    console.error('Error reading images:', error);
    return NextResponse.json(
      { error: 'Failed to fetch images' },
      { status: 500 }
    );
  }
}
