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
        
        // Decode URL-encoded filename
        const decodedFilename = decodeURIComponent(filename);
        const normalizedRequest = decodedFilename.toLowerCase();
        
        // Try exact match first (fastest) - case sensitive
        let blob: any = allBlobs.find((b: any) => {
          const blobFilename = b.pathname.split('/').pop() || b.pathname;
          return blobFilename === decodedFilename || blobFilename === filename;
        });
        
        // If exact match not found, try case-insensitive exact match
        if (!blob) {
          blob = allBlobs.find((b: any) => {
            const blobFilename = b.pathname.split('/').pop() || b.pathname;
            return blobFilename.toLowerCase() === normalizedRequest;
          });
        }
        
        // If still not found, try multiple matching strategies
        if (!blob) {
          // Strategy 1: Match by base name (everything before last hyphen)
          const requestParts = decodedFilename.split('-');
          const requestBaseName = requestParts.length > 1 
            ? requestParts.slice(0, -1).join('-') 
            : decodedFilename.split('.')[0];
          const normalizedBaseName = requestBaseName.toLowerCase();
          
          blob = allBlobs.find((b: any) => {
            const blobFilename = b.pathname.split('/').pop() || b.pathname;
            const blobParts = blobFilename.split('-');
            const blobBaseName = blobParts.length > 1 
              ? blobParts.slice(0, -1).join('-') 
              : blobFilename.split('.')[0];
            
            return blobBaseName === requestBaseName ||
                   blobBaseName.toLowerCase() === normalizedBaseName;
          });
        }
        
        // Strategy 2: Contains match (if base name match didn't work)
        if (!blob) {
          const requestBaseName = decodedFilename.split('.')[0]; // Everything before extension
          blob = allBlobs.find((b: any) => {
            const blobFilename = b.pathname.split('/').pop() || b.pathname;
            const blobBaseName = blobFilename.split('.')[0];
            // Check if either contains the other (handles partial matches)
            return blobBaseName.includes(requestBaseName) ||
                   requestBaseName.includes(blobBaseName) ||
                   blobFilename.includes(decodedFilename) ||
                   decodedFilename.includes(blobFilename);
          });
        }
        
        // Strategy 3: Pathname ends with (last resort)
        if (!blob) {
          blob = allBlobs.find((b: any) => {
            return b.pathname.endsWith(decodedFilename) ||
                   b.pathname.endsWith(filename);
          });
        }
        
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

