import { NextRequest, NextResponse } from 'next/server';
import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const IS_VERCEL = process.env.VERCEL === '1';
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const METADATA_FILE = path.join(process.cwd(), 'public', 'uploads', 'metadata.json');

interface ImageMetadata {
  filename: string;
  productUrl?: string;
  productName?: string;
  productDescription?: string;
}

async function loadMetadata(): Promise<Record<string, ImageMetadata>> {
  try {
    if (existsSync(METADATA_FILE)) {
      const content = await readFile(METADATA_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Error loading metadata:', error);
  }
  return {};
}

async function saveMetadata(metadata: Record<string, ImageMetadata>): Promise<void> {
  try {
    const { writeFile, mkdir } = await import('fs/promises');
    const dir = path.dirname(METADATA_FILE);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving metadata:', error);
  }
}

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
        
        console.log(`Looking for filename: ${filename} (decoded: ${decodedFilename})`);
        console.log(`Total blobs searched: ${allBlobs.length}`);
        if (allBlobs.length > 0) {
          const sampleFilenames = allBlobs.slice(0, 10).map(b => b.pathname.split('/').pop());
          console.log(`Sample blob filenames:`, sampleFilenames);
          // Check if any sample matches
          const matchingSample = sampleFilenames.find(f => f && (f.includes(decodedFilename) || decodedFilename.includes(f?.split('-')[0] || '')));
          if (matchingSample) {
            console.log(`Potential match found in samples: ${matchingSample}`);
          }
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
    const decodedFilename = decodeURIComponent(filename);
    const filePath = path.join(UPLOAD_DIR, decodedFilename);

    console.log('Serving image:', {
      requestedFilename: filename,
      decodedFilename: decodedFilename,
      filePath: filePath,
      exists: existsSync(filePath)
    });

    if (!existsSync(filePath)) {
      // Try with original filename if decoded doesn't work
      const altPath = path.join(UPLOAD_DIR, filename);
      if (existsSync(altPath)) {
        const fileBuffer = await readFile(altPath);
        return new NextResponse(fileBuffer, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }
      console.error('File not found:', { filePath, altPath });
      return NextResponse.json({ 
        error: 'File not found',
        details: `Looking for: ${decodedFilename}`
      }, { status: 404 });
    }

    const fileBuffer = await readFile(filePath);
    
    console.log('Successfully serving image:', decodedFilename);
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

export async function DELETE(
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

    if (IS_VERCEL) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return NextResponse.json({ error: 'Blob storage not configured' }, { status: 503 });
      }
      
      try {
        // Delete from Vercel Blob Storage
        const { list, del } = await import('@vercel/blob');
        
        // Decode URL-encoded filename
        const decodedFilename = decodeURIComponent(filename);
        
        // List all blobs to find the one matching the filename
        let allBlobs: any[] = [];
        let cursor: string | undefined = undefined;
        
        do {
          const result: { blobs: any[]; cursor?: string } = await list({ limit: 1000, cursor });
          allBlobs = allBlobs.concat(result.blobs);
          cursor = result.cursor;
        } while (cursor);
        
        // Find the blob matching the filename
        const blob = allBlobs.find((b: any) => {
          const blobFilename = b.pathname.split('/').pop() || b.pathname;
          return blobFilename === decodedFilename || 
                 blobFilename === filename ||
                 blobFilename.toLowerCase() === decodedFilename.toLowerCase();
        });
        
        if (!blob) {
          return NextResponse.json({ error: 'File not found in blob storage' }, { status: 404 });
        }
        
        // Delete using blob URL (recommended method)
        await del(blob.url);
        
        // Remove from metadata
        const metadata = await loadMetadata();
        if (metadata[filename]) {
          delete metadata[filename];
          await saveMetadata(metadata);
        }
        
        return NextResponse.json({ 
          success: true, 
          message: 'Image deleted successfully' 
        });
      } catch (error) {
        console.error('Error deleting blob:', error);
        return NextResponse.json(
          { error: 'Failed to delete image' },
          { status: 500 }
        );
      }
    } else {
      // Local file system
      const filePath = path.join(UPLOAD_DIR, filename);

      if (!existsSync(filePath)) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      // Delete file
      await unlink(filePath);
      
      // Remove from metadata
      const metadata = await loadMetadata();
      if (metadata[filename]) {
        delete metadata[filename];
        await saveMetadata(metadata);
      }
      
      return NextResponse.json({ 
        success: true, 
        message: 'Image deleted successfully' 
      });
    }
  } catch (error) {
    console.error('Error deleting image:', error);
    return NextResponse.json(
      { error: 'Failed to delete image' },
      { status: 500 }
    );
  }
}
