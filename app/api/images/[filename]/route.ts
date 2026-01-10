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
        const { blobs } = await list();
        
        // Try to find blob by exact filename match in pathname
        const blob = blobs.find(b => {
          const blobFilename = b.pathname.split('/').pop() || b.pathname;
          return blobFilename === filename || b.pathname.endsWith(filename);
        });
        
        console.log(`Looking for filename: ${filename}`);
        console.log(`Found blob:`, blob ? { pathname: blob.pathname, url: blob.url } : 'Not found');
        
        if (blob && blob.url) {
          // Redirect to blob URL directly (more efficient)
          return NextResponse.redirect(blob.url, 307);
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
