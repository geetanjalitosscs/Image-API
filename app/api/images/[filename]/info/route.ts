import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { list } from '@vercel/blob';
import { existsSync, statSync } from 'fs';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const IS_VERCEL = process.env.VERCEL === '1';
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  try {
    const filename = params.filename;
    
    if (!filename) {
      return NextResponse.json({ error: 'Filename required' }, { status: 400 });
    }

    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    }

    const contentType = 
      ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
      ext === '.png' ? 'image/png' :
      ext === '.webp' ? 'image/webp' :
      'application/octet-stream';

    if (IS_VERCEL) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return NextResponse.json({ error: 'Blob storage not configured' }, { status: 503 });
      }
      try {
        const { list } = await import('@vercel/blob');
        let allBlobs: any[] = [];
        let cursor: string | undefined = undefined;
        
        // Fetch all blobs to find the specific one
        do {
          const result: { blobs: any[]; cursor?: string } = await list({ limit: 1000, cursor });
          allBlobs = allBlobs.concat(result.blobs);
          cursor = result.cursor;
        } while (cursor);
        
        const blob = allBlobs.find(b => {
          const blobFilename = b.pathname.split('/').pop() || b.pathname;
          return blobFilename === filename || b.pathname.endsWith(filename);
        });
        
        if (!blob) {
          return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }

        return NextResponse.json({
          success: true,
          filename: filename,
          url: blob.url,
          apiUrl: `/api/images/${filename}`,
          pathname: blob.pathname,
          size: (blob as any).size || null,
          uploadedAt: (blob as any).uploadedAt || null,
          contentType: contentType,
        }, {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          }
        });
      } catch (error) {
        console.error('Error fetching blob info:', error);
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
    }

    // Local file system
    const filePath = path.join(UPLOAD_DIR, filename);

    if (!existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const stats = statSync(filePath);
    
    return NextResponse.json({
      success: true,
      filename: filename,
      url: `/api/images/${filename}`,
      apiUrl: `/api/images/${filename}`,
      pathname: `/uploads/${filename}`,
      size: stats.size,
      uploadedAt: stats.mtime.toISOString(),
      contentType: contentType,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      }
    });
  } catch (error) {
    console.error('Error getting file info:', error);
    return NextResponse.json(
      { error: 'Failed to get file info' },
      { status: 500 }
    );
  }
}

