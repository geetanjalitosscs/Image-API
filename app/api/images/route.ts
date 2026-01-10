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

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
        // List all blobs with higher limit to get all images
        let allBlobs: any[] = [];
        let cursor: string | undefined = undefined;
        
        // Fetch all blobs with pagination
        do {
          const result: { blobs: any[]; cursor?: string } = await list({ limit: 1000, cursor });
          allBlobs = allBlobs.concat(result.blobs);
          cursor = result.cursor;
        } while (cursor);
        
        console.log('Total blobs found:', allBlobs.length);
        console.log('Blob samples:', allBlobs.slice(0, 3).map(b => ({ pathname: b.pathname, url: b.url })));
        
        const imageFiles = allBlobs
          .filter(blob => {
            const ext = path.extname(blob.pathname).toLowerCase();
            return ALLOWED_EXTENSIONS.includes(ext);
          })
          .map(blob => {
            // Extract filename from pathname (handle both /filename and filename formats)
            const filename = blob.pathname.split('/').pop() || blob.pathname;
            // Get file extension to determine content type
            const ext = path.extname(filename).toLowerCase();
            const contentType = 
              ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
              ext === '.png' ? 'image/png' :
              ext === '.webp' ? 'image/webp' :
              null;
            // Return complete image data
            return {
              url: blob.url,
              title: filename.replace(ext, '').replace(/_/g, ' ').trim() || 'Untitled Image',
              description: `Image uploaded on ${new Date((blob as any).uploadedAt || Date.now()).toLocaleDateString()}`,
              size: (blob as any).size || null,
              uploadedAt: (blob as any).uploadedAt || null,
              contentType: contentType
            };
          })
          .sort((a, b) => a.title.localeCompare(b.title));
        
        console.log('Filtered image files:', imageFiles.length);
        return NextResponse.json({ 
          success: true,
          count: imageFiles.length,
          images: imageFiles
        }, {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });
      } catch (error) {
        console.error('Error listing blobs:', error);
        return NextResponse.json({ 
          success: false,
          count: 0,
          images: [],
          error: error instanceof Error ? error.message : 'Failed to list images'
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
          const ext = path.extname(file).toLowerCase();
          const contentType = 
            ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
            ext === '.png' ? 'image/png' :
            ext === '.webp' ? 'image/webp' :
            null;
          return {
            url: `/api/images/${file}`,
            title: file.replace(ext, '').replace(/_/g, ' ').trim() || 'Untitled Image',
            description: stats ? `Image uploaded on ${new Date(stats.mtime).toLocaleDateString()}` : 'Image',
            size: stats ? stats.size : null,
            uploadedAt: stats ? stats.mtime.toISOString() : null,
            contentType: contentType
          };
        })
        .sort((a, b) => a.title.localeCompare(b.title));

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
