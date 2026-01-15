import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { list } from '@vercel/blob';

interface ImageMetadata {
  filename: string;
  flipkartUrl?: string;
  productName?: string;
  productDescription?: string;
}

const METADATA_FILE = path.join(process.cwd(), 'public', 'uploads', 'metadata.json');

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const IS_VERCEL = process.env.VERCEL === '1';

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

function isValidImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

function extractProductName(filename: string): string {
  // Extract product name from filename (everything before the last underscore and random suffix)
  // Example: "phone1_9712de3ac759785d.webp" -> "phone1"
  // Example: "product_name_abc123.jpg" -> "product name"
  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  
  // Split by underscore and take all parts except the last one (which is the random suffix)
  const parts = baseName.split('_');
  if (parts.length > 1) {
    // Remove the last part (random suffix) and join the rest
    const productParts = parts.slice(0, -1);
    return productParts.join(' ').trim() || baseName;
  }
  
  // If no underscore, return the base name
  return baseName;
}

function getProductImageUrl(filename: string, request?: NextRequest): string {
  // Generate product image URL like: http://localhost:3000/api/images/filename.jpg
  if (request) {
    // Use request headers to get the host
    const protocol = request.headers.get('x-forwarded-proto') || 
                     (request.url.startsWith('https') ? 'https' : 'http');
    const host = request.headers.get('host') || 'localhost:3000';
    return `${protocol}://${host}/api/images/${filename}`;
  }
  // Fallback for local development
  const protocol = process.env.NEXT_PUBLIC_PROTOCOL || 'http';
  const host = process.env.NEXT_PUBLIC_HOST || 'localhost:3000';
  return `${protocol}://${host}/api/images/${filename}`;
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
    const dir = path.dirname(METADATA_FILE);
    if (!existsSync(dir)) {
      await require('fs/promises').mkdir(dir, { recursive: true });
    }
    await writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving metadata:', error);
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
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
        
        const metadata = await loadMetadata();
        
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
            
            // Get metadata for this file
            const fileMetadata = metadata[filename] || {};
            
            // Use Flipkart product name if available, otherwise extract from filename
            const productName = fileMetadata.productName || extractProductName(filename);
            const productImageUrl = getProductImageUrl(filename, request);
            
            // Return complete image data in specified order
            const title = filename.replace(ext, '').replace(/_/g, ' ').trim() || 'Untitled Image';
            const description = fileMetadata.productDescription || `Image uploaded on ${new Date((blob as any).uploadedAt || Date.now()).toLocaleDateString()}`;
            
            return {
              filename: filename,
              productName: productName,
              title: title,
              Url: fileMetadata.flipkartUrl || null,
              productImageUrl: productImageUrl,
              description: description,
              uploadedAt: (blob as any).uploadedAt || null,
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

      const metadata = await loadMetadata();
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
          
          // Get metadata for this file
          const fileMetadata = metadata[file] || {};
          
          // Use Flipkart product name if available, otherwise extract from filename
          const productName = fileMetadata.productName || extractProductName(file);
          const productImageUrl = getProductImageUrl(file, request);
          
          // Return complete image data in specified order
          const title = file.replace(ext, '').replace(/_/g, ' ').trim() || 'Untitled Image';
          const description = fileMetadata.productDescription || (stats ? `Image uploaded on ${new Date(stats.mtime).toLocaleDateString()}` : 'Image');
          
          return {
            filename: file,
            productName: productName,
            title: title,
            Url: fileMetadata.flipkartUrl || null,
            productImageUrl: productImageUrl,
            description: description,
            uploadedAt: stats ? stats.mtime.toISOString() : null,
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
