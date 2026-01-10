import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const IS_VERCEL = process.env.VERCEL === '1';
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

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
      // On Vercel, use list to find the blob and get its URL
      try {
        const { list } = await import('@vercel/blob');
        
        // Fetch all blobs with pagination to find the specific one
        let allBlobs: any[] = [];
        let cursor: string | undefined = undefined;
        
        do {
          const result: { blobs: any[]; cursor?: string } = await list({ limit: 1000, cursor });
          allBlobs = allBlobs.concat(result.blobs);
          cursor = result.cursor;
        } while (cursor);
        
        // Decode URL-encoded filename
        const decodedFilename = decodeURIComponent(filename);
        
        // Try to find blob by multiple matching strategies
        const blob: any = allBlobs.find((b: any) => {
          const blobFilename = b.pathname.split('/').pop() || b.pathname;
          
          // Extract base name (everything before last hyphen, which is Vercel suffix)
          const blobParts = blobFilename.split('-');
          const blobBaseName = blobParts.length > 1 
            ? blobParts.slice(0, -1).join('-') 
            : blobFilename.split('.')[0];
          
          const requestParts = decodedFilename.split('-');
          const requestBaseName = requestParts.length > 1 
            ? requestParts.slice(0, -1).join('-') 
            : decodedFilename.split('.')[0];
          
          // Multiple matching strategies
          return blobFilename === decodedFilename ||  // Exact match
                 blobFilename === filename ||  // Original encoded match
                 blobBaseName === requestBaseName ||  // Base name match (before Vercel suffix)
                 blobFilename.includes(decodedFilename) ||  // Contains match
                 decodedFilename.includes(blobBaseName) ||  // Reverse contains
                 blobBaseName.includes(requestBaseName) ||  // Base contains
                 requestBaseName.includes(blobBaseName) ||  // Reverse base contains
                 blob.pathname.endsWith(decodedFilename) ||  // Pathname ends with
                 blob.pathname.endsWith(filename);  // Original encoded ends with
        });
        
        console.log(`Looking for filename: ${filename} (decoded: ${decodedFilename})`);
        console.log(`Total blobs searched: ${allBlobs.length}`);
        if (allBlobs.length > 0) {
          console.log(`Sample blob filenames:`, allBlobs.slice(0, 5).map(b => b.pathname.split('/').pop()));
        }
        console.log(`Found blob:`, blob ? { pathname: blob.pathname, url: blob.url } : 'Not found');
        
        if (blob && blob.url) {
          // Return image directly instead of redirect (works better in Postman)
          const imageResponse = await fetch(blob.url);
          if (imageResponse.ok) {
            const imageBlob = await imageResponse.blob();
            return new NextResponse(imageBlob, {
              headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000, immutable',
              },
            });
          }
        }
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      } catch (error) {
        console.error('Error fetching blob:', error);
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
    }

    // Local file system
    const filePath = path.join(UPLOAD_DIR, filename);

    if (!existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const fileBuffer = await readFile(filePath);
    
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error serving image:', error);
    return NextResponse.json(
      { error: 'Failed to serve image' },
      { status: 500 }
    );
  }
}
